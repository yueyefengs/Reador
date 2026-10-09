import { randomUUID } from 'node:crypto';
import { and,eq,sql,inArray } from 'drizzle-orm';
import { db } from '../../lib/db';
import { books,chapters,sources,jobs,artifacts,questions,reviewCards } from '../../lib/schema';
import { parseBook } from '../books/parse';
import { STRUCTURE_VERSION } from '../books/structure';
import { upgradeStructure } from '../books/upgrade';
import { readStoredFile,sealFile } from '../../lib/storage';
import { callModel,ModelOutputError } from '../ai/provider';
import { generateGraph } from '../ai/graph';
import { summarySchema,questionSchema,validateRubric } from '../ai/validation';
import { createEmptyCard } from 'ts-fsrs';
import { AppError,assert } from '../../lib/errors';
type Job=typeof jobs.$inferSelect;
async function claim():Promise<Job|undefined>{return db.transaction(async tx=>{
  const rows=await tx.execute(sql`select id from jobs where status='queued' or (status='running' and lease<now()) order by created_at for update skip locked limit 1`);
  if(!rows[0])return;
  const [job]=await tx.update(jobs).set({status:'running',lease:new Date(Date.now()+90000),token:randomUUID()}).where(eq(jobs.id,rows[0].id as string)).returning();return job;
})}
async function parse(job:Job){
  const [book]=await db.select().from(books).where(and(eq(books.id,job.bookId),eq(books.ownerId,job.ownerId)));assert(book,404,'书籍不存在');if(book.status==='ready')return;
  await db.update(books).set({status:'parsing',error:null}).where(eq(books.id,book.id));
  const parsed=await parseBook(await readStoredFile(book.storagePath),book.format);
  const coverCipher=parsed.cover?sealFile(parsed.cover,'cover:'+book.ownerId+':'+book.id).toString('base64'):null;
  await db.transaction(async tx=>{
    // 文件解析和原文入库一次提交；失败不会留下一半目录。
    await tx.execute(sql`select id from jobs where id=${job.id} for update`);
    const [latest]=await tx.select().from(jobs).where(eq(jobs.id,job.id));if(latest.status!=='running'||latest.token!==job.token)return;
    for(const [position,chapter] of parsed.chapters.entries()){
      const [entry]=await tx.insert(chapters).values({ownerId:job.ownerId,bookId:book.id,position,title:chapter.title,inferred:chapter.inferred,origin:chapter.origin,depth:chapter.depth}).returning();
      // 长章分批入库，避免超过 PostgreSQL 的单次参数数量限制。
      for(let offset=0;offset<chapter.blocks.length;offset+=500)await tx.insert(sources).values(chapter.blocks.slice(offset,offset+500).map((block,index)=>({ownerId:job.ownerId,bookId:book.id,chapterId:entry.id,position:offset+index,...block})));
    }
    await tx.update(books).set({status:'ready',error:null,coverCipher,structureVersion:STRUCTURE_VERSION}).where(eq(books.id,book.id));
  });
}
async function extractCover(job:Job){
  const [book]=await db.select().from(books).where(and(eq(books.id,job.bookId),eq(books.ownerId,job.ownerId)));assert(book,404,'书籍不存在');
  if(book.coverCipher)return;
  const parsed=await parseBook(await readStoredFile(book.storagePath),book.format);
  if(!parsed.cover)return;
  const coverCipher=sealFile(parsed.cover,'cover:'+book.ownerId+':'+book.id).toString('base64');
  await db.transaction(async tx=>{
    await tx.execute(sql`select id from jobs where id=${job.id} for update`);
    const [current]=await tx.select().from(jobs).where(eq(jobs.id,job.id));
    if(current.status==='running'&&current.token===job.token)await tx.update(books).set({coverCipher}).where(and(eq(books.id,book.id),eq(books.ownerId,job.ownerId)));
  });
}
export async function processJob(job:Job){
  const controller=new AbortController();let cancelled=false;
  const heartbeat=setInterval(async()=>{
    try{const [current]=await db.update(jobs).set({lease:new Date(Date.now()+90000)}).where(and(eq(jobs.id,job.id),eq(jobs.token,job.token!),eq(jobs.status,'running'))).returning({id:jobs.id});if(!current){cancelled=true;controller.abort()}}catch{controller.abort()}
  },20000);heartbeat.unref();
  const guard=()=>and(eq(jobs.id,job.id),eq(jobs.token,job.token!),eq(jobs.status,'running'));
  try{
    if(job.kind==='parse')await parse(job);
    else if(job.kind==='cover')await extractCover(job);
    else if(job.kind==='structure')await upgradeStructure(job);
    else{
      assert(job.agentSnapshot,422,'生成任务缺少模型配置');
      let consecutiveOutputErrors=0;
      for(const [batch,ids] of job.sourceBatches.entries()){
        if(job.results.some(result=>result.batch===batch))continue;
        const [live]=await db.select({status:jobs.status,token:jobs.token}).from(jobs).where(eq(jobs.id,job.id));
        if(!live||live.status!=='running'||live.token!==job.token){cancelled=true;break}
        let outputError=false;
        try{
          const text=await db.select().from(sources).where(and(eq(sources.ownerId,job.ownerId),eq(sources.bookId,job.bookId),inArray(sources.id,ids)));assert(text.length===ids.length,422,'任务原文范围已变化');
          const ordered=ids.map(id=>text.find(source=>source.id===id)!);
          const input={sources:ordered.map(source=>({sourceId:source.id,text:source.text}))};
          let data:unknown;
          if(job.kind==='graph')data=await generateGraph(job.agentSnapshot,ordered,controller.signal);
          else if(job.kind==='summary')data=await callModel(job.agentSnapshot,'总结本批原文的主旨、概念与易混淆点，每个条目附来源。不要假设覆盖本章或全书。',summarySchema,input,text,controller.signal);
          else{data=await callModel(job.agentSnapshot,'为本批原文生成 1 到 3 道简答题。goal 是可独立检测的知识目标；rubric 权重合计必须为 100；附参考答案与引用。',questionSchema,input,text,controller.signal);(data as ReturnType<typeof questionSchema.parse>).questions.forEach(question=>validateRubric(question.rubric))}
          job.results.push({batch,data});job.errors=job.errors.filter(item=>item.batch!==batch);consecutiveOutputErrors=0;
        }catch(error){if(controller.signal.aborted)throw error;outputError=error instanceof ModelOutputError;consecutiveOutputErrors=outputError?consecutiveOutputErrors+1:0;job.errors=job.errors.filter(item=>item.batch!==batch);job.errors.push({batch,message:error instanceof AppError?error.message:'本批处理失败，请重试'});}
        const [saved]=await db.update(jobs).set({results:job.results,errors:job.errors}).where(guard()).returning({id:jobs.id});if(!saved){cancelled=true;break}
        // 同一配置连续无法形成有效输出时暂停，保留未处理批次供显式重试。
        if(outputError&&consecutiveOutputErrors>=2)break;
      }
    }
    if(cancelled)return;
    await db.transaction(async tx=>{
      await tx.execute(sql`select id from jobs where id=${job.id} for update`);
      const [current]=await tx.select().from(jobs).where(eq(jobs.id,job.id));if(current.status!=='running'||current.token!==job.token)return;
      if(job.kind!=='parse'&&job.results.length){
        const [artifact]=await tx.insert(artifacts).values({ownerId:job.ownerId,bookId:job.bookId,jobId:job.id,kind:job.kind,data:job.results}).onConflictDoNothing().returning();
        if(!artifact)await tx.update(artifacts).set({data:job.results}).where(eq(artifacts.jobId,job.id));
        if(job.kind==='questions'){
          // 每一知识目标单独建卡，任务重试保留已有卡片与调度。
          const prior=await tx.select().from(questions).where(eq(questions.jobId,job.id));
          for(const result of job.results){for(const [index,item] of (result.data as ReturnType<typeof questionSchema.parse>).questions.entries()){
            const marker=`${result.batch}:${index}`;
            const questionId=randomUUID();
            if(prior.some(question=>question.batchKey===marker))continue;
            const [question]=await tx.insert(questions).values({id:questionId,ownerId:job.ownerId,bookId:job.bookId,jobId:job.id,...item,batchKey:marker}).returning();
            const now=new Date();await tx.insert(reviewCards).values({ownerId:job.ownerId,bookId:job.bookId,questionId:question.id,schedule:createEmptyCard(now),dueAt:now});
          }}
        }
      }
      const failed=job.kind!=='parse'&&job.results.length<job.sourceBatches.length;
      await tx.update(jobs).set({status:failed?(job.results.length?'partial':'failed'):'ready',lease:null,token:null,results:job.results,errors:job.errors}).where(eq(jobs.id,job.id));
    });
  }catch(error){
    const message=error instanceof AppError?error.message:'任务处理失败，请重试';
    await db.update(jobs).set({status:'failed',token:null,lease:null,errors:[...job.errors,{batch:-1,message}]}).where(guard());
    if(job.kind==='parse')await db.update(books).set({status:'failed',error:message}).where(and(eq(books.id,job.bookId),eq(books.ownerId,job.ownerId)));
  }finally{clearInterval(heartbeat)}
}
const globalWorker=globalThis as unknown as {readorWorker?:boolean};
export function startWorker(){
  if(globalWorker.readorWorker||!process.env.DATABASE_URL)return;globalWorker.readorWorker=true;
  const tick=async()=>{try{const job=await claim();if(job)await processJob(job)}catch{console.error('任务轮询失败，请检查数据库连接')}finally{const timer=setTimeout(tick,1200);timer.unref()}};
  void tick();
}
