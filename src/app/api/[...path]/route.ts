import { NextResponse } from 'next/server';
import { readStoredFile,openFile } from '../../../lib/storage';
import { z } from 'zod';
import { and,eq,asc,desc,sql,inArray,lte,getTableColumns } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { users,agents,books,chapters,sources,progress,jobs,artifacts,questions,reviewCards,attempts,reviewLogs,conversations,messages } from '../../../lib/schema';
import { currentUser,createSession,logout,verifyOrigin,rateLimit } from '../../../lib/auth';
import { hashPassword,verifyPassword,encrypt } from '../../../lib/security';
import { assert,AppError } from '../../../lib/errors';
import { upload,ownedBook,getSources,queueStructure } from '../../../modules/books/service';
import { batchSources } from '../../../modules/books/batches';
import { presets,agentInput,validateBase,callModel } from '../../../modules/ai/provider';
import { environmentModels,environmentAgent } from '../../../modules/ai/environment';
import { replySchema } from '../../../modules/ai/validation';
import { defaultAgent,ownedCard,ownedAttempt,submitAttempt,gradeAttempt,rateAttempt,remedy,safeQuestion,correctAttempt,startAttempt,markAssistance } from '../../../modules/learning/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const {storagePath:privateStoragePath,hash:privateHash,coverCipher:privateCoverCipher,...publicBookColumns}=getTableColumns(books);
const uuid=z.uuid(),key=z.string().min(8).max(120),rating=z.enum(['Again','Hard','Good','Easy']);
async function body(request:Request,limit=1024*1024){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let size=0;const chunks:Uint8Array[]=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new AppError(413,'请求内容超过限制')}chunks.push(value)}return Buffer.concat(chunks)}
async function json(request:Request){try{return JSON.parse(Buffer.from(await body(request)).toString())}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'请求 JSON 无效')}}
const safeAgent=(agent:typeof agents.$inferSelect)=>{const {keyCipher,...rest}=agent;return {...rest,hasKey:!!keyCipher}};
const safeJob=(job:typeof jobs.$inferSelect)=>{const {agentSnapshot,token,results,sourceBatches,...rest}=job;return {...rest,total:sourceBatches.length,completed:results.length,coverage:sourceBatches.filter((_,index)=>results.some(result=>result.batch===index)).flat()}};
async function handle(request:Request,{params}:{params:Promise<{path:string[]}>}){
  const path=(await params).path;const method=request.method;const url=new URL(request.url);const action=path.join('/');
  if(method!=='GET')verifyOrigin(request);
  if(action==='health'&&method==='GET'){await db.execute(sql`select 1`);return {ok:true}}
  if((action==='auth/register'||action==='auth/login')&&method==='POST'){
    const input=z.object({email:z.email().max(254).transform(value=>value.toLowerCase().trim()),password:z.string().min(12).max(128),name:z.string().trim().min(1).max(80).optional()}).strict().parse(await json(request));
    await rateLimit('auth:'+input.email,10);await rateLimit('auth-global',100,15*60000);
    let [user]=await db.select().from(users).where(eq(users.email,input.email));
    if(action==='auth/register'){
      assert(input.name,422,'请填写昵称');assert(!user,409,'此邮箱已注册');
      try{[user]=await db.insert(users).values({email:input.email,name:input.name,passwordHash:await hashPassword(input.password)}).returning()}catch(error){if((error as {cause?:{code?:string}}).cause?.code==='23505')throw new AppError(409,'此邮箱已注册');throw error}
    }else assert(user&&await verifyPassword(input.password,user.passwordHash),401,'邮箱或密码不正确');
    await createSession(user.id);return {id:user.id,email:user.email,name:user.name,timezone:user.timezone};
  }
  const user=await currentUser(),ownerId=user.id;
  if(action==='auth/me'&&method==='GET')return {id:user.id,email:user.email,name:user.name,timezone:user.timezone};
  if(action==='auth/logout'&&method==='POST'){await logout();return {ok:true}}
  if(action==='auth/profile'&&method==='PATCH'){const input=z.object({timezone:z.string().max(80)}).strict().parse(await json(request));try{new Intl.DateTimeFormat('zh-CN',{timeZone:input.timezone})}catch{throw new AppError(422,'时区无效')}await db.update(users).set(input).where(eq(users.id,ownerId));return {ok:true}}
  if(action==='presets'&&method==='GET')return presets;
  if(action==='environment-models'&&method==='GET')return environmentModels(user.email);
  if(path[0]==='environment-models'&&method==='POST'){const provider=z.enum(['deepseek','glm']).parse(path[1]);const config=environmentAgent(user.email,provider);await rateLimit('ai:'+ownerId,100,3600000);if(path[2]==='test'){const result=await callModel(config,'回复连接成功。这是最小连接测试，不涉及书籍。',z.object({message:z.string().min(1).max(100)}).strict(),{message:'请回复连接成功'},[]);return {ok:true,message:result.message}}if(path[2]==='import'){const {id,...value}=config;const saved=await db.transaction(async tx=>{await tx.execute(sql`select id from users where id=${ownerId} for update`);await tx.update(agents).set({isDefault:false}).where(eq(agents.ownerId,ownerId));const [row]=await tx.insert(agents).values({...value,ownerId}).returning();return row});return safeAgent(saved)}}
  if(path[0]==='agents'){
    if(path.length===1&&method==='GET')return(await db.select().from(agents).where(eq(agents.ownerId,ownerId)).orderBy(asc(agents.createdAt))).map(safeAgent);
    const id=path[1]?uuid.parse(path[1]):undefined;
    const existing=id?(await db.select().from(agents).where(and(eq(agents.id,id),eq(agents.ownerId,ownerId))))[0]:undefined;if(id)assert(existing,404,'Agent 配置不存在');
    if(path[2]==='test'&&method==='POST'){await rateLimit('ai:'+ownerId,100,3600000);const result=await callModel(existing!,'回复固定内容“连接成功”。这是用户主动发起的最小连接测试，不涉及书籍。',z.object({message:z.string().min(1).max(100)}).strict(),{message:'请回复连接成功'},[]);return {ok:true,message:result.message}}
    if(method==='DELETE'&&id){const active=await db.select().from(jobs).where(and(eq(jobs.ownerId,ownerId),eq(jobs.agentId,id),inArray(jobs.status,['queued','running','partial','failed'])));assert(!active.length,409,'此配置仍被可重试的任务引用，请保留该配置');await db.update(jobs).set({agentId:null}).where(and(eq(jobs.ownerId,ownerId),eq(jobs.agentId,id)));await db.delete(agents).where(and(eq(agents.id,id),eq(agents.ownerId,ownerId)));return {ok:true}}
    if((method==='POST'&&!id)||(method==='PUT'&&id)){
      const input=agentInput.parse(await json(request));const baseUrl=validateBase(input.baseUrl);
      if(input.route==='official')assert(input.provider!=='custom'&&baseUrl===presets[input.provider].baseUrl,422,'官方接入地址不匹配，请使用官方预设或切换第三方');
      assert(input.apiKey||existing?.keyCipher,422,'请填写 API Key');
      if(existing&&existing.baseUrl!==baseUrl)assert(input.apiKey,422,'更换服务地址时请重新填写 API Key');
      const {apiKey,temperature,...data}=input;
      const saved=await db.transaction(async tx=>{
        await tx.execute(sql`select id from users where id=${ownerId} for update`);
        if(input.isDefault)await tx.update(agents).set({isDefault:false}).where(eq(agents.ownerId,ownerId));
        const value={...data,baseUrl,temperature:temperature===null?null:String(temperature),keyCipher:apiKey?encrypt(apiKey):existing!.keyCipher,ownerId};
        const [entry]=id?await tx.update(agents).set(value).where(and(eq(agents.id,id),eq(agents.ownerId,ownerId))).returning():await tx.insert(agents).values(value).returning();return entry;
      });return safeAgent(saved);
    }
  }
  if(action==='books'&&method==='GET'){
    const list=await db.select({...publicBookColumns,hasCover:sql<boolean>`${books.coverCipher} is not null`}).from(books).where(eq(books.ownerId,ownerId)).orderBy(desc(books.createdAt));const cards=await db.select().from(reviewCards).where(eq(reviewCards.ownerId,ownerId));return list.map(book=>({...book,due:cards.filter(card=>card.bookId===book.id&&card.dueAt<=new Date()).length,cards:cards.filter(card=>card.bookId===book.id).length}));
  }
  if(action==='books'&&method==='POST'){
    await rateLimit('upload:'+ownerId,30,3600000);const bytes=await body(request,51*1024*1024);const copy=new Request(request.url,{method:'POST',headers:request.headers,body:bytes});const form=await copy.formData();const file=form.get('file');assert(file instanceof File,422,'请选择书籍文件');const book=await upload(ownerId,file);return {id:book.id,status:book.status};
  }
  if(path[0]==='sources'&&path[1]&&method==='GET'){const [source]=await db.select().from(sources).where(and(eq(sources.id,uuid.parse(path[1])),eq(sources.ownerId,ownerId)));assert(source,404,'原文片段不存在');await markAssistance(ownerId,source.bookId);return source;}
  if(path[0]==='books'&&path[1]){
    const bookId=uuid.parse(path[1]),book=await ownedBook(ownerId,bookId);
    if(path.length===2&&method==='GET'){
      const catalog=await db.select().from(chapters).where(and(eq(chapters.ownerId,ownerId),eq(chapters.bookId,bookId),eq(chapters.active,true))).orderBy(asc(chapters.position));
      const [saved]=await db.select().from(progress).where(and(eq(progress.ownerId,ownerId),eq(progress.bookId,bookId)));
      const {storagePath,hash,coverCipher,...safe}=book;return {...safe,hasCover:!!coverCipher,chapters:catalog,progress:saved||null};
    }
    if(path[2]==='structure'&&method==='POST'){const job=await queueStructure(ownerId,bookId);return job?safeJob(job):{status:'ready'};}
    if(path[2]==='cover'&&method==='GET'){assert(book.coverCipher,404,'此书暂无封面');const bytes=openFile(Buffer.from(book.coverCipher,'base64'),'cover:'+ownerId+':'+bookId);return new Response(bytes,{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff'}});}
    if(path[2]==='file'&&method==='GET'){await markAssistance(ownerId,bookId);const bytes=await readStoredFile(book.storagePath);return new Response(bytes,{headers:{'content-type':book.format==='PDF'?'application/pdf':'application/epub+zip','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(book.filename),'cache-control':'private, no-store','x-content-type-options':'nosniff'}});}
    if(path[2]==='sources'&&method==='GET'){const chapterId=uuid.parse(url.searchParams.get('chapterId'));await markAssistance(ownerId,bookId);return getSources(ownerId,bookId,[chapterId])}
    if(path[2]==='progress'&&method==='PUT'){
      const input=z.object({chapterId:uuid,sourceId:uuid.nullable().default(null)}).strict().parse(await json(request));const [chapter]=await db.select().from(chapters).where(and(eq(chapters.id,input.chapterId),eq(chapters.ownerId,ownerId),eq(chapters.bookId,bookId),eq(chapters.active,true)));assert(chapter,404,'章节不存在');if(input.sourceId){const text=await getSources(ownerId,bookId,[input.chapterId]);const source=text.find(source=>source.id===input.sourceId);assert(source,404,'原文位置不存在');input.chapterId=source.chapterId}
      await db.insert(progress).values({ownerId,bookId,...input}).onConflictDoUpdate({target:[progress.ownerId,progress.bookId],set:{...input,updatedAt:new Date()}});return {ok:true};
    }
    if(path[2]==='jobs'&&method==='POST'){
      assert(book.status==='ready',422,'书籍尚未完成解析');await rateLimit('ai:'+ownerId,100,3600000);
      const input=z.object({kind:z.enum(['summary','graph','questions']),chapterIds:z.array(uuid).max(800),agentId:uuid.optional(),idempotencyKey:key}).strict().parse(await json(request));const agent=await defaultAgent(ownerId,input.agentId);
      const catalog=await db.select().from(chapters).where(and(eq(chapters.ownerId,ownerId),eq(chapters.bookId,bookId),eq(chapters.active,true)));assert(input.chapterIds.every(id=>catalog.some(chapter=>chapter.id===id)),404,'章节不属于当前书籍');
      const text=await getSources(ownerId,bookId,input.chapterIds);assert(text.length,422,'当前范围没有原文');const batches=batchSources(text);
      const [job]=await db.insert(jobs).values({ownerId,bookId,agentId:agent.id,agentSnapshot:agent,kind:input.kind,chapterIds:input.chapterIds.length?input.chapterIds:catalog.map(chapter=>chapter.id),sourceBatches:batches,idempotencyKey:input.idempotencyKey}).onConflictDoNothing().returning();const saved=job||(await db.select().from(jobs).where(and(eq(jobs.ownerId,ownerId),eq(jobs.idempotencyKey,input.idempotencyKey))))[0];assert(saved.bookId===bookId&&saved.kind===input.kind,409,'任务提交标识已使用');return safeJob(saved);
    }
    if(path[2]==='jobs'&&method==='GET')return(await db.select().from(jobs).where(and(eq(jobs.ownerId,ownerId),eq(jobs.bookId,bookId))).orderBy(desc(jobs.createdAt))).map(safeJob);
    // 出题任务的内部产物包含参考答案，只能通过作答后的专用接口读取。
    if(path[2]==='artifacts'&&method==='GET')return db.select().from(artifacts).where(and(eq(artifacts.ownerId,ownerId),eq(artifacts.bookId,bookId),sql`${artifacts.kind}<>'questions'`)).orderBy(desc(artifacts.createdAt));
  }
  if(path[0]==='jobs'&&path[1]&&method==='POST'){
    const id=uuid.parse(path[1]);const [job]=await db.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.ownerId,ownerId)));assert(job,404,'任务不存在');
    if(path[2]==='cancel'){assert(job.kind!=='parse',422,'文件解析不支持中途取消');await db.update(jobs).set({status:'cancelled',token:null,lease:null}).where(and(eq(jobs.id,id),inArray(jobs.status,['queued','running'])));return {ok:true}}
    if(path[2]==='retry'){assert(['partial','failed'].includes(job.status),409,'当前任务无需重试');if(!['parse','cover','structure'].includes(job.kind))await rateLimit('ai:'+ownerId,100,3600000);await db.update(jobs).set({status:'queued',errors:[],lease:null,token:null}).where(and(eq(jobs.id,id),inArray(jobs.status,['partial','failed'])));return {ok:true}}
  }
  if(action==='reviews'&&method==='GET'){
    const bookId=url.searchParams.get('bookId');if(bookId)await ownedBook(ownerId,uuid.parse(bookId));
    const rows=await db.select({card:reviewCards,question:questions,book:books}).from(reviewCards).innerJoin(questions,eq(questions.id,reviewCards.questionId)).innerJoin(books,eq(books.id,reviewCards.bookId)).where(and(eq(reviewCards.ownerId,ownerId),...(bookId?[eq(reviewCards.bookId,bookId)]:[]))).orderBy(asc(reviewCards.dueAt));return rows.map(row=>({...row.card,question:safeQuestion(row.question),title:row.book.title,due:row.card.dueAt<=new Date()}));
  }
  if(path[0]==='cards'&&path[1]){
    const cardId=uuid.parse(path[1]);const card=await ownedCard(ownerId,cardId);
    if(path[2]==='question'&&method==='GET'){const [question]=await db.select().from(questions).where(and(eq(questions.id,card.questionId),eq(questions.ownerId,ownerId)));assert(question,404,'题目不存在');return safeQuestion(question)}
    if(path[2]==='start'&&method==='POST'){const input=z.object({idempotencyKey:key}).strict().parse(await json(request));return startAttempt(ownerId,cardId,input.idempotencyKey);}
    if(path[2]==='attempts'&&method==='POST'){await rateLimit('ai:'+ownerId,100,3600000);const input=z.object({answer:z.string().trim().min(1).max(12000),assisted:z.boolean(),questionId:uuid.optional(),idempotencyKey:key}).strict().parse(await json(request));return submitAttempt(ownerId,cardId,input)}
  }
  if(path[0]==='attempts'){
    if(path.length===1&&method==='GET')return db.select().from(attempts).where(eq(attempts.ownerId,ownerId)).orderBy(desc(attempts.createdAt)).limit(100);
    const id=uuid.parse(path[1]);const attempt=await ownedAttempt(ownerId,id);
    if(path.length===2&&method==='GET')return attempt;
    if(path[2]==='grade'&&method==='POST'){await rateLimit('ai:'+ownerId,100,3600000);return gradeAttempt(ownerId,id)}
    if(path[2]==='rating'&&method==='POST')return rateAttempt(ownerId,id,z.object({rating}).strict().parse(await json(request)).rating);
    if(path[2]==='correction'&&method==='POST'){const input=z.object({score:z.number().min(0).max(100),reason:z.string().trim().min(1).max(1500)}).strict().parse(await json(request));return correctAttempt(ownerId,id,input.score,input.reason)}
    if(path[2]==='reference'&&method==='GET'){assert(attempt.assessment,422,'完成作答与评分后才能查看参考答案');const [question]=await db.select().from(questions).where(and(eq(questions.id,attempt.questionId),eq(questions.ownerId,ownerId)));return question}
    if(path[2]==='remedy'&&method==='POST'){await rateLimit('ai:'+ownerId,100,3600000);return safeQuestion(await remedy(ownerId,id))}
  }
  if(action==='review-history'&&method==='GET')return db.select().from(reviewLogs).where(eq(reviewLogs.ownerId,ownerId)).orderBy(desc(reviewLogs.createdAt)).limit(100);
  if(action==='conversations'&&method==='GET'){const bookId=uuid.parse(url.searchParams.get('bookId'));await ownedBook(ownerId,bookId);return db.select().from(conversations).where(and(eq(conversations.ownerId,ownerId),eq(conversations.bookId,bookId))).orderBy(desc(conversations.createdAt));}
  if(action==='conversations'&&method==='POST'){
    const input=z.object({bookId:uuid,chapterId:uuid.nullable(),selectedSourceId:uuid.nullable().default(null)}).strict().parse(await json(request));await ownedBook(ownerId,input.bookId);
    if(input.chapterId){const [chapter]=await db.select().from(chapters).where(and(eq(chapters.id,input.chapterId),eq(chapters.bookId,input.bookId),eq(chapters.ownerId,ownerId),eq(chapters.active,true)));assert(chapter,404,'章节不存在')}
    if(input.selectedSourceId){assert(input.chapterId,422,'选段需要指定章节');const text=await getSources(ownerId,input.bookId,[input.chapterId]);assert(text.some(source=>source.id===input.selectedSourceId),404,'选段不在当前章')}
    const [entry]=await db.insert(conversations).values({ownerId,...input}).returning();return entry;
  }
  if(path[0]==='conversations'&&path[1]){
    const id=uuid.parse(path[1]);const [conversation]=await db.select().from(conversations).where(and(eq(conversations.id,id),eq(conversations.ownerId,ownerId)));assert(conversation,404,'会话不存在');
    if(path.length===2&&method==='GET'){await markAssistance(ownerId,conversation.bookId);return {...conversation,messages:await db.select().from(messages).where(and(eq(messages.ownerId,ownerId),eq(messages.conversationId,id))).orderBy(asc(messages.createdAt))};}
    if(path[2]==='messages'&&method==='POST'){
      const input=z.object({question:z.string().trim().min(1).max(4000),mode:z.enum(['qa','diagnose','hint','explain','check']),idempotencyKey:key}).strict().parse(await json(request));
      const [prior]=await db.select().from(messages).where(and(eq(messages.ownerId,ownerId),eq(messages.idempotencyKey,input.idempotencyKey)));if(prior){assert(prior.conversationId===id,409,'消息标识已使用');return prior}
      await rateLimit('ai:'+ownerId,100,3600000);const agent=await defaultAgent(ownerId);await markAssistance(ownerId,conversation.bookId);
      let text=await getSources(ownerId,conversation.bookId,conversation.chapterId?[conversation.chapterId]:undefined);if(conversation.selectedSourceId)text=text.filter(source=>source.id===conversation.selectedSourceId);
      const full=text.length,total=text.reduce((sum,source)=>sum+source.text.length,0);let range='当前选定范围';
      if(total>20000){const words=input.question.toLowerCase().match(/[\p{L}\p{N}]{1,2}/gu)||[];text=text.map(source=>({source,score:words.reduce((sum,word)=>sum+(source.text.toLowerCase().includes(word)?1:0),0)})).sort((a,b)=>b.score-a.score).slice(0,12).map(item=>item.source);range='当前范围中检索到的 '+text.length+' / '+full+' 个片段'}
      const history=await db.select().from(messages).where(and(eq(messages.ownerId,ownerId),eq(messages.conversationId,id))).orderBy(desc(messages.createdAt)).limit(6);
      const modes={qa:'回答问题',diagnose:'先问一个诊断问题，不要直接泄露完整答案',hint:'只给下一步提示，不显示完整答案',explain:'给出直接讲解与例子，补充例子明确标注为解释性例子',check:'检查用户对当前解释的理解，并给出反馈'};
      const reply=await callModel(agent,modes[input.mode]+'。只能引用本次 sources；历史仅用于理解问题，不能提供范围外事实。若证据不足，insufficient=true，说明限制并建议用户主动扩大范围，不能自动扩大。',replySchema,{sources:text.map(source=>({sourceId:source.id,text:source.text})),range,question:input.question,history:history.reverse().map(item=>({question:item.question,answer:item.answer,mode:item.mode}))},text);
      const [saved]=await db.insert(messages).values({ownerId,conversationId:id,mode:input.mode,question:input.question,...reply,idempotencyKey:input.idempotencyKey}).onConflictDoNothing().returning();return saved||(await db.select().from(messages).where(and(eq(messages.ownerId,ownerId),eq(messages.idempotencyKey,input.idempotencyKey))))[0];
    }
  }
  throw new AppError(404,'接口不存在');
}
async function route(request:Request,context:{params:Promise<{path:string[]}>}){try{const data=await handle(request,context);if(data instanceof Response)return data;return NextResponse.json(data,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}})}catch(error){if(error instanceof z.ZodError)return NextResponse.json({error:'请求参数无效：'+error.issues.map(issue=>issue.path.join('.')).join('、')},{status:422});if(error instanceof AppError)return NextResponse.json({error:error.message},{status:error.status});console.error('请求处理失败',{type:error instanceof Error?error.name:'unknown',code:(error as {cause?:{code?:string}})?.cause?.code,location:error instanceof Error?error.stack?.split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,3):[]});return NextResponse.json({error:'服务暂时无法完成请求，请稍后重试'},{status:500})}}
export {route as GET,route as POST,route as PUT,route as PATCH,route as DELETE};
