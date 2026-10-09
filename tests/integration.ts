import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq,inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { rm } from 'node:fs/promises';
const admin=postgres(process.env.DATABASE_URL!,{max:1});
const database='reador_test_'+randomUUID().replace(/-/g,'');
await admin.unsafe('CREATE DATABASE '+database);
const databaseUrl=new URL(process.env.DATABASE_URL!);databaseUrl.pathname='/'+database;process.env.DATABASE_URL=databaseUrl.href;
const {db,client}=await import('../src/lib/db');
await migrate(db,{migrationsFolder:'drizzle'});
const uploadDir='/tmp/'+database;
import { users,agents,jobs,reviewCards,reviewLogs,questions,attempts,artifacts,conversations,messages,books,chapters,sources,progress } from '../src/lib/schema';
import { makeEpub,makePdf,makeStructuredEpub } from './fixtures';
let invalid=false,failCitationOnce=false,calls=0,failLongSummary=false,longSummaryCalls=0,truncateGraphOutput=false,captureGraphCalls=false,graphCalls=0;
const longSummaryInputs:string[][]=[];
const mock=createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());calls++;
 const system=body.instructions||body.system||body.messages?.find((item:{role:string})=>item.role==='system')?.content||'';
 const input=JSON.parse(body.input||body.messages?.filter((item:{role:string})=>item.role==='user').at(-1)?.content||'{}');
 const source=input.sources?.[0],citation=source?{sourceId:source.sourceId,quote:source.text.slice(0,15)}:null;let data:unknown;
 if(system.includes('连接测试'))data={message:'连接成功'};
 else if(system.includes('提取本批'))data={nodes:[{id:'recall',label:'主动回忆',definition:'先独立提取内容',citations:[invalid?{...citation,quote:'不存在的伪造摘录'}:citation]}],edges:[],warnings:[]};
 else if(system.includes('总结本批原文'))data={items:[{title:'核心观点',text:'先独立回忆，再核对原文。',citations:[citation]}]};
 else if(system.includes('简答题')||system.includes('换一种情境'))data={questions:[{goal:'区分独立回忆和答案熟悉感',prompt:'为什么应该先独立回忆，再核对原文？',answer:'可以发现理解缺口。',rubric:[{point:'发现理解缺口',weight:100}],citations:[citation]}]};
 else if(system.includes('逐条评分'))data={points:[{index:0,earned:invalid?120:70,feedback:'提到了主要要点，仍可补充细节'}],feedback:'保留独立作答，再核对原文中的缺口。',recommendation:'Good',citations:[citation]};
 else data={answer:'当前原文强调先独立回忆，再核对材料。',insufficient:false,citations:[citation]};
 if(failLongSummary&&system.includes('总结本批原文')){longSummaryCalls++;longSummaryInputs.push(input.sources.map((source:{sourceId:string})=>source.sourceId));if(longSummaryCalls===2){res.statusCode=503;res.end('{}');return}}
 if(captureGraphCalls&&system.includes('提取本批')){
  graphCalls++;
  if(truncateGraphOutput){res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url?.endsWith('/responses')?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}:req.url?.endsWith('/messages')?{stop_reason:'max_tokens',content:[]}:{choices:[{finish_reason:'length',message:{content:null,reasoning_content:'预算被思考用完'}}]}));return}
 }
 if(system.includes('提取本批')&&failCitationOnce){(data as any).nodes[0].citations[0].quote='首次生成改写了摘录';failCitationOnce=false}
 const text=JSON.stringify(data);res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url?.endsWith('/responses')?{output:[{content:[{type:'output_text',text}]}]}:req.url?.endsWith('/messages')?{content:[{type:'text',text}]}:{choices:[{message:{content:text}}]}));
});
await new Promise<void>(resolve=>mock.listen(0,'127.0.0.1',resolve));const mockPort=(mock.address() as {port:number}).port;
const port=3114,base=`http://127.0.0.1:${port}`;
let output='';const app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,APP_ORIGIN:base,NEXT_DIST_DIR:'.next-integration',AI_ALLOW_PRIVATE_NETWORK:'true',AI_DNS_MODE:'system',STORAGE_BACKEND:'local',ENV_MODEL_ACCESS:'owner',ENV_MODEL_OWNER_EMAIL:'system@reador.local',DEEPSEEK_API_KEY:'ENV_KEY_NOT_REAL',DEEPSEEK_MODEL:'contract-fixture',DEEPSEEK_BASE_URL:`http://127.0.0.1:${mockPort}/v1`,GLM_API_KEY:'',UPLOAD_DIR:uploadDir},stdio:['ignore','pipe','pipe']});app.stdout.on('data',data=>output+=data.toString());app.stderr.on('data',data=>output+=data.toString());
const owners:string[]=[];let checks=0;
const check=(value:unknown,message:string)=>{assert.ok(value,message);checks++};
class Browser{
 cookie='';async req(path:string,method='GET',data?:unknown,expected=200):Promise<any>{const response=await fetch(base+'/api/'+path,{method,headers:{origin:base,...(this.cookie?{cookie:this.cookie}:{}),...(data instanceof FormData?{}:{'content-type':'application/json'})},...(data!==undefined?{body:data instanceof FormData?data:JSON.stringify(data)}:{})});const set=response.headers.get('set-cookie');if(set)this.cookie=set.split(';')[0];const result=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);return result}
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitJob(browser:Browser,bookId:string,id:string,status='ready'){for(let i=0;i<120;i++){const list=await browser.req('books/'+bookId+'/jobs');const job=list.find((job:any)=>job.id===id);if(job?.status===status)return job;if(['failed','partial'].includes(job?.status)&&status==='ready')throw new Error('任务失败：'+JSON.stringify(job.errors));await pause(500)}throw new Error('等待任务超时')}
try{
 for(let i=0;i<100;i++){try{const res=await fetch(base+'/api/health');if(res.ok)break}catch{}if(i===99)throw new Error('测试应用启动失败');await pause(400)}
 const a=new Browser(),b=new Browser();await new Browser().req('books','GET',undefined,401);
 const emailA=`system@reador.local`,emailB=`test-${randomUUID()}@reador.local`;
 const userA=await a.req('auth/register','POST',{name:'测试甲',email:emailA,password:'reador-test-password-A'});owners.push(userA.id);const userB=await b.req('auth/register','POST',{name:'测试乙',email:emailB,password:'reador-test-password-B'});owners.push(userB.id);
 check(a.cookie.includes('reador_session='),'注册建立会话');await new Browser().req('auth/login','POST',{email:emailA,password:'wrong-password-123'},401);
 const csrf=await fetch(base+'/api/agents',{method:'POST',headers:{cookie:a.cookie,'content-type':'application/json',origin:'https://evil.example'},body:'{}'});check(csrf.status===403,'拒绝跨站写入');
 const serverModels=await a.req('environment-models');check(serverModels.length===1&&!JSON.stringify(serverModels).includes('ENV_KEY'),'服务器配置仅返回模型元数据');check((await b.req('environment-models')).length===0,'服务器模型按邮箱授权');await b.req('environment-models/deepseek/import','POST',{},422);const imported=await a.req('environment-models/deepseek/import','POST');check(imported.ownerId===userA.id&&!('keyCipher' in imported),'服务器配置另存为当前账号且不泄露凭据');check(imported.maxTokens===1_000_000,'环境模型导入保留 1M 期望输出上限');
 const defaultBudgetAgent=await a.req('agents','POST',{name:'默认预算验证',provider:'custom',route:'third-party',protocol:'chat',baseUrl:`http://127.0.0.1:${mockPort}/v1`,model:'contract-fixture',apiKey:'DEMO_KEY_NOT_REAL'});check(defaultBudgetAgent.maxTokens===1_000_000,'新建 API 未填写输出上限时默认 1M');await a.req('agents/'+defaultBudgetAgent.id,'DELETE');
 let agent:any;
 for(const protocol of ['chat','responses','messages']){agent=await a.req('agents','POST',{name:'测试 '+protocol,provider:'custom',route:'third-party',protocol,baseUrl:`http://127.0.0.1:${mockPort}/v1`,model:'contract-fixture',apiKey:'DEMO_KEY_NOT_REAL',timeout:10,retries:0,maxTokens:4096,temperature:null,isDefault:true});check(!JSON.stringify(agent).includes('DEMO_KEY')&&!('keyCipher'in agent),'密钥不回传');await a.req('agents/'+agent.id+'/test','POST');}
 const [secret]=await db.select().from(agents).where(eq(agents.id,agent.id));check(!secret.keyCipher.includes('DEMO_KEY'),'密钥加密入库');check((await b.req('agents')).length===0,'模型配置隔离');await b.req('agents/'+agent.id+'/test','POST',{},404);
 const epubBytes=await makeEpub(false,{cover:'epub3'});const form=new FormData();form.append('file',new File([epubBytes],'原创测试.epub'));const book=await a.req('books','POST',form);const duplicate=new FormData();duplicate.append('file',new File([epubBytes],'原创测试.epub'));const again=await a.req('books','POST',duplicate);check(book.id===again.id,'重复上传返回同一本书');
 const job=(await a.req('books/'+book.id+'/jobs'))[0];await waitJob(a,book.id,job.id);const detail=await a.req('books/'+book.id);check(detail.chapters.length===2,'EPUB 两章真实解析');const original=await fetch(base+'/api/books/'+book.id+'/file',{headers:{cookie:a.cookie}});check(original.ok&&Buffer.from(await original.arrayBuffer()).equals(epubBytes),'原始文件保持不变且可下载');await b.req('books/'+book.id+'/file','GET',undefined,404);check((await b.req('books')).length===0,'书库隔离');await b.req('books/'+book.id,'GET',undefined,404);
 const cover=await fetch(base+'/api/books/'+book.id+'/cover',{headers:{cookie:a.cookie}});const coverBytes=Buffer.from(await cover.arrayBuffer());check(cover.ok&&cover.headers.get('content-type')==='image/jpeg'&&cover.headers.get('cache-control')==='private, no-store','EPUB 封面通过私有图片接口读取');
 const library=await a.req('books');check(library[0].hasCover&&!JSON.stringify(library).includes('coverCipher')&&!JSON.stringify(detail).includes('coverCipher'),'列表和详情只返回封面存在标记');
 const [storedBook]=await db.select().from(books).where(eq(books.id,book.id));check(storedBook.coverCipher&&!storedBook.coverCipher.includes(coverBytes.toString('base64')),'封面加密保存');
 await b.req('books/'+book.id+'/cover','GET',undefined,404);await new Browser().req('books/'+book.id+'/cover','GET',undefined,401);
 const text=await a.req('books/'+book.id+'/sources?chapterId='+detail.chapters[0].id);await b.req('sources/'+text[0].id,'GET',undefined,404);
 await a.req('books/'+book.id+'/progress','PUT',{chapterId:detail.chapters[0].id,sourceId:text[0].id});check((await a.req('books/'+book.id)).progress.sourceId===text[0].id,'阅读进度持久化');
 const beforeNoModelUpload=calls;
 const formB=new FormData();formB.append('file',new File([makePdf()],'测试乙.pdf'));const bookB=await b.req('books','POST',formB);const parseB=(await b.req('books/'+bookB.id+'/jobs'))[0];await waitJob(b,bookB.id,parseB.id);const detailB=await b.req('books/'+bookB.id);check(detailB.chapters.length===2&&detailB.hasCover,'PDF 两页真实解析并提取首页封面');check(calls===beforeNoModelUpload&&parseB.kind==='parse','没有可用模型时上传解析成功，且没有模型调用');await b.req('books/'+bookB.id+'/jobs','POST',{kind:'summary',chapterIds:[],idempotencyKey:randomUUID()},422);check((await b.req('books/'+bookB.id+'/jobs')).length===1,'未配置模型时拒绝 AI 生成，不创建假结果任务');await a.req('books/'+book.id+'/progress','PUT',{chapterId:detailB.chapters[0].id,sourceId:null},404);
 try{await db.insert(questions).values({ownerId:userB.id,bookId:book.id,goal:'错误归属',prompt:'问题',answer:'答案',rubric:[{point:'一点',weight:100}],citations:[]});assert.fail('数据库接受了跨账号关联')}catch(error){check((error as any).cause?.code==='23503','数据库关联约束隔离')}
 invalid=true;const beforeInvalidGraph=calls;const graphJob=await a.req('books/'+book.id+'/jobs','POST',{kind:'graph',chapterIds:[detail.chapters[0].id],idempotencyKey:randomUUID()});const rejectedGraph=await waitJob(a,book.id,graphJob.id,'failed');check(!(await a.req('books/'+book.id+'/artifacts')).length,'无效来源不发布图谱');check(calls-beforeInvalidGraph===2&&rejectedGraph.errors[0].message.includes('摘录与原文不逐字匹配'),'引用错误仅重生成一次并保存明确原因');invalid=false;failCitationOnce=true;const beforeGraphRecovery=calls;await a.req('jobs/'+graphJob.id+'/retry','POST');const recoveredGraph=await waitJob(a,book.id,graphJob.id);check((await a.req('books/'+book.id+'/artifacts')).length===1,'失败批次可恢复');check(calls-beforeGraphRecovery===2&&recoveredGraph.errors.length===0,'引用重生成成功后发布图谱且不残留错误');
 for(const kind of ['summary','questions']){const idempotencyKey=randomUUID();const generated=await a.req('books/'+book.id+'/jobs','POST',{kind,chapterIds:[detail.chapters[0].id],idempotencyKey});const retry=await a.req('books/'+book.id+'/jobs','POST',{kind,chapterIds:[detail.chapters[0].id],idempotencyKey});check(generated.id===retry.id,'生成任务幂等');await waitJob(a,book.id,generated.id);}
 const cards=await a.req('reviews?bookId='+book.id);check(cards.length===1&&cards[0].bookId===book.id,'复习卡关联书籍');check(!JSON.stringify(cards).includes('发现理解缺口'),'作答前不返回参考答案');check((await a.req('books/'+book.id+'/artifacts')).every((item:any)=>item.kind!=='questions'),'生成产物接口不泄露出题答案');check((await b.req('reviews')).length===0,'复习卡隔离');await b.req('cards/'+cards[0].id+'/question','GET',undefined,404);
 const started=await a.req('cards/'+cards[0].id+'/start','POST',{idempotencyKey:randomUUID()});
 const submit={answer:'先回忆可以发现理解缺口。',assisted:false,idempotencyKey:started.idempotencyKey};invalid=true;await a.req('cards/'+cards[0].id+'/attempts','POST',submit,502);const saved=(await a.req('attempts'))[0];check(saved&&!saved.assessment,'评分失败仍保留原始答案');invalid=false;const attempt=await a.req('attempts/'+saved.id+'/grade','POST');check(attempt.assessment.score===70,'服务端核算评分');await b.req('attempts/'+attempt.id,'GET',undefined,404);
 const rating=await Promise.all([a.req('attempts/'+attempt.id+'/rating','POST',{rating:'Good'}),a.req('attempts/'+attempt.id+'/rating','POST',{rating:'Good'})]);check(rating[0].id===rating[1].id,'重复并发评级只写一条记录');const [card]=await db.select().from(reviewCards).where(eq(reviewCards.id,cards[0].id));check(card.version===1&&card.dueAt>new Date(),'FSRS 状态和到期时间持久化');check((await db.select().from(reviewLogs).where(eq(reviewLogs.cardId,card.id))).length===1,'无重复复习记录');
 const prior=await a.req('cards/'+card.id+'/attempts','POST',submit);check(prior.id===attempt.id,'已评级后重复提交仍幂等');await a.req('cards/'+card.id+'/attempts','POST',{...submit,idempotencyKey:randomUUID()},409);
 const remedial=await a.req('attempts/'+attempt.id+'/remedy','POST');const practice=await a.req('cards/'+card.id+'/attempts','POST',{answer:'回忆能暴露缺口。',assisted:true,questionId:remedial.id,idempotencyKey:randomUUID()});check(practice.kind==='remedy','补救练习单独记录');await a.req('attempts/'+practice.id+'/rating','POST',{rating:'Good'},422);check((await db.select().from(reviewLogs).where(eq(reviewLogs.cardId,card.id))).length===1,'补救不产生成功复习记录');
 const textTwo=await a.req('books/'+book.id+'/sources?chapterId='+detail.chapters[1].id);
 const [questionTwo]=await db.insert(questions).values({ownerId:userA.id,bookId:book.id,goal:'另一知识目标',prompt:'如何核对学习反馈？',answer:'回到原文。',rubric:[{point:'核对原文',weight:100}],citations:[{sourceId:textTwo[0].id,quote:textTwo[0].text.slice(0,15)}]}).returning();
 const {createEmptyCard}=await import('ts-fsrs');const [secondCard]=await db.insert(reviewCards).values({ownerId:userA.id,bookId:book.id,questionId:questionTwo.id,schedule:createEmptyCard(new Date()),dueAt:new Date()}).returning();
 const draft=await a.req('cards/'+secondCard.id+'/start','POST',{idempotencyKey:randomUUID()});await a.req('sources/'+textTwo[0].id);const helped=await a.req('cards/'+secondCard.id+'/attempts','POST',{answer:'回到原文。',assisted:false,idempotencyKey:draft.idempotencyKey});check(helped.assisted,'查看原文由服务端记录辅助，客户端无法抹去');await a.req('attempts/'+helped.id+'/rating','POST',{rating:'Good'},422);await a.req('cards/'+secondCard.id+'/attempts','POST',{answer:'换个答案',assisted:false,idempotencyKey:randomUUID()},409);await a.req('attempts/'+helped.id+'/rating','POST',{rating:'Again'});
 const [stale]=await db.insert(jobs).values({ownerId:userA.id,bookId:book.id,agentId:secret.id,agentSnapshot:secret,kind:'summary',chapterIds:[detail.chapters[0].id],sourceBatches:[[text[0].id]],status:'running',token:randomUUID(),lease:new Date(0),idempotencyKey:randomUUID()}).returning();await waitJob(a,book.id,stale.id);check((await a.req('books/'+book.id+'/artifacts')).some((artifact:any)=>artifact.jobId===stale.id),'过期任务租约可恢复');
 const convo=await a.req('conversations','POST',{bookId:book.id,chapterId:detail.chapters[0].id});const msg=await a.req('conversations/'+convo.id+'/messages','POST',{question:'为什么先回忆？',mode:'qa',idempotencyKey:randomUUID()});check(msg.citations[0].sourceId===text[0].id,'问答范围内引用');await b.req('conversations/'+convo.id,'GET',undefined,404);check((await a.req('conversations/'+convo.id)).messages.length===1,'会话历史持久化');
 await db.update(agents).set({isDefault:false}).where(eq(agents.ownerId,userA.id));const fallback=await a.req('books/'+book.id+'/jobs','POST',{kind:'summary',chapterIds:[detail.chapters[0].id],idempotencyKey:randomUUID()});await waitJob(a,book.id,fallback.id);check(fallback.agentId===null,'无个人默认配置时使用服务器模型且保持拥有者隔离');
 await a.req('auth/logout','POST');await a.req('books','GET',undefined,401);await a.req('auth/login','POST',{email:emailA,password:'reador-test-password-A'});check((await a.req('books')).length===1&&(await a.req('reviews')).find((entry:any)=>entry.id===card.id).version===1,'重新登录后学习记录仍在');
 // 用重新上传补旧书封面，验证学习状态和来源身份保持不变。
 await db.update(books).set({coverCipher:null}).where(eq(books.id,book.id));const refill=new FormData();refill.append('file',new File([epubBytes],'原创测试.epub'));const reused=await a.req('books','POST',refill);check(reused.id===book.id,'补封面复用原书');const coverJob=(await a.req('books/'+book.id+'/jobs')).find((job:any)=>job.kind==='cover');await waitJob(a,book.id,coverJob.id);const recovered=await a.req('books/'+book.id);check(recovered.hasCover&&recovered.chapters[0].id===detail.chapters[0].id,'补封面不重建章节与来源');check((await a.req('reviews')).find((entry:any)=>entry.id===card.id).version===1,'补封面不改变复习状态');
 await db.update(books).set({coverCipher:null}).where(eq(books.id,book.id));await db.update(jobs).set({status:'cancelled'}).where(eq(jobs.id,coverJob.id));const resumeCover=new FormData();resumeCover.append('file',new File([epubBytes],'原创测试.epub'));await a.req('books','POST',resumeCover);await waitJob(a,book.id,coverJob.id);check((await a.req('books/'+book.id)).hasCover,'再次上传可恢复已取消的封面任务');
 const longForm=new FormData();longForm.append('file',new File([await makeEpub(false,{textRepeat:250})],'长书分批测试.epub'));const longBook=await a.req('books','POST',longForm);await waitJob(a,longBook.id,(await a.req('books/'+longBook.id+'/jobs'))[0].id);const longDetail=await a.req('books/'+longBook.id);check(!longDetail.hasCover,'无封面保留文字封面');await a.req('books/'+longBook.id+'/cover','GET',undefined,404);
 // 使用明确无重试的模拟配置，检查部分失败后只补失败批次。
 await db.update(agents).set({isDefault:true}).where(eq(agents.id,secret.id));failLongSummary=true;
 const longJob=await a.req('books/'+longBook.id+'/jobs','POST',{kind:'summary',chapterIds:[],idempotencyKey:randomUUID()});const partial=await waitJob(a,longBook.id,longJob.id,'partial');check(partial.total>1&&partial.completed===partial.total-1,'长书分批保存成功批次与部分失败');
 const longSources=(await Promise.all(longDetail.chapters.map((chapter:any)=>a.req('books/'+longBook.id+'/sources?chapterId='+chapter.id)))).flat();check(longSummaryInputs.flat().join(',')===longSources.map((source:any)=>source.id).join(','),'发送模型的长书片段完整且有序');for(const ids of longSummaryInputs)check(ids.reduce((sum,id)=>sum+longSources.find((source:any)=>source.id===id).text.length,0)<=10000,'单批正文不超过 10000 字符');
 await a.req('jobs/'+longJob.id+'/retry','POST');const completed=await waitJob(a,longBook.id,longJob.id);check(completed.completed===completed.total&&longSummaryCalls===completed.total+1,'重试只发送失败批次');check(longSummaryInputs.at(-1)?.join(',')===longSummaryInputs[1].join(','),'重试保留原批次来源与顺序');failLongSummary=false;
 // 同一模型配置连续输出截断时保留余下批次，避免整本书无效调用。
 captureGraphCalls=true;truncateGraphOutput=true;
 const stoppedGraph=await a.req('books/'+longBook.id+'/jobs','POST',{kind:'graph',chapterIds:[],idempotencyKey:randomUUID()});
 const graphFailure=await waitJob(a,longBook.id,stoppedGraph.id,'failed');check(graphFailure.total>2&&graphCalls===2&&graphFailure.completed===0&&graphFailure.errors.length===2,'连续两批输出截断后停止，剩余批次不调用模型');
 check(graphFailure.errors.every((error:any)=>error.message.includes('截断')),'输出上限错误明确显示截断原因，不冒充取消');
 check(!(await a.req('books/'+longBook.id+'/artifacts')).some((artifact:any)=>artifact.jobId===stoppedGraph.id),'截断响应不发布半份图谱');
 truncateGraphOutput=false;await a.req('jobs/'+stoppedGraph.id+'/retry','POST');const graphRecovered=await waitJob(a,longBook.id,stoppedGraph.id);
 check(graphRecovered.completed===graphRecovered.total&&graphCalls===graphRecovered.total+2,'显式重试可恢复失败及未执行批次');captureGraphCalls=false;
 // 已有题目、作答、FSRS 与会话的旧书更新，来源身份及历史保持不变。
 await db.update(books).set({structureVersion:0}).where(eq(books.id,book.id));
 const learningBefore=JSON.stringify({cards:await db.select().from(reviewCards).where(eq(reviewCards.bookId,book.id)),attempts:await db.select().from(attempts).where(eq(attempts.bookId,book.id)),logs:await db.select().from(reviewLogs).where(eq(reviewLogs.bookId,book.id))});
 const upgrade=await a.req('books/'+book.id+'/structure','POST');await waitJob(a,book.id,upgrade.id);
 const updated=await a.req('books/'+book.id);check(updated.structureVersion===1&&updated.chapters.every((chapter:any)=>chapter.active),'旧书目录更新只展示新目录');
 check((await a.req('sources/'+text[0].id)).text===text[0].text&&(await a.req('books/'+book.id)).progress.sourceId===text[0].id,'目录更新保留原文身份、文本和阅读片段');
 check(JSON.stringify({cards:await db.select().from(reviewCards).where(eq(reviewCards.bookId,book.id)),attempts:await db.select().from(attempts).where(eq(attempts.bookId,book.id)),logs:await db.select().from(reviewLogs).where(eq(reviewLogs.bookId,book.id))})===learningBefore,'目录更新保留作答、FSRS 及复习历史');
 check((await a.req('conversations/'+convo.id)).messages.length===1,'更新前会话历史仍可读取');
 const callsBeforeIdempotent=calls;await a.req('books/'+book.id+'/structure','POST');check((await a.req('books/'+book.id)).chapters[0].id===updated.chapters[0].id&&calls===callsBeforeIdempotent,'重复更新目录幂等且不调用模型');await b.req('books/'+book.id+'/structure','POST',{},404);
 // 将带目录材料还原为旧版逐文件结构，验证跨文件合并与历史范围冻结。
 const structuredForm=new FormData();structuredForm.append('file',new File([await makeStructuredEpub({toc:'nav',layout:'nested'})],'目录更新测试.epub'));
 const structuredBook=await a.req('books','POST',structuredForm);await waitJob(a,structuredBook.id,(await a.req('books/'+structuredBook.id+'/jobs'))[0].id);
 const nested=await a.req('books/'+structuredBook.id),parentText=await a.req('books/'+structuredBook.id+'/sources?chapterId='+nested.chapters[0].id);
 check(parentText.length===3,'选择父目录包含其子章节原文');
 const parentConversation=await a.req('conversations','POST',{bookId:structuredBook.id,chapterId:nested.chapters[0].id,selectedSourceId:parentText.at(-1).id});
 await a.req('books/'+structuredBook.id+'/progress','PUT',{chapterId:nested.chapters[0].id,sourceId:parentText.at(-1).id});check((await a.req('books/'+structuredBook.id)).progress.chapterId===parentText.at(-1).chapterId,'父目录阅读进度定位到实际子章节');
 const structuredSources=await db.select().from(sources).where(eq(sources.bookId,structuredBook.id));
 const [legacy]=await db.insert(chapters).values({ownerId:userA.id,bookId:structuredBook.id,position:100,title:'旧版第二文件',origin:'legacy'}).returning();
 const legacySource=structuredSources.find(source=>source.locator.href==='OEBPS/two.xhtml')!;
 await db.update(sources).set({chapterId:legacy.id,position:0}).where(eq(sources.id,legacySource.id));
 const legacyConversation=await a.req('conversations','POST',{bookId:structuredBook.id,chapterId:legacy.id});
 await db.update(books).set({structureVersion:0}).where(eq(books.id,structuredBook.id));
 const structureJob=await a.req('books/'+structuredBook.id+'/structure','POST');await waitJob(a,structuredBook.id,structureJob.id);
 check((await db.select().from(sources).where(eq(sources.bookId,structuredBook.id))).every(source=>structuredSources.some(old=>old.id===source.id&&old.text===source.text&&JSON.stringify(old.locator)===JSON.stringify(source.locator))),'跨文件重新分组保留所有来源 ID、原文与位置');
 const {getSources}=await import('../src/modules/books/service');
 const frozen=await getSources(userA.id,structuredBook.id,[legacy.id]);check(frozen.length===1&&frozen[0].id===legacySource.id,'目录更新保留旧会话的单文件引用范围');
 const merged=await a.req('books/'+structuredBook.id);check((await a.req('books/'+structuredBook.id+'/sources?chapterId='+merged.chapters[0].id)).length===3,'更新后的父目录正确合并来源');
 check((await a.req('conversations/'+parentConversation.id)).selectedSourceId===parentText.at(-1).id&&(await a.req('conversations/'+legacyConversation.id)).id===legacyConversation.id,'选段与旧会话引用保持有效');
 // 不一致时拒绝升级，失败不留下半份新目录，修复后原任务可重试。
 await db.update(books).set({structureVersion:0}).where(eq(books.id,bookB.id));const pdfSource=(await b.req('books/'+bookB.id+'/sources?chapterId='+detailB.chapters[0].id))[0];
 await db.update(sources).set({text:pdfSource.text+'被改动'}).where(eq(sources.id,pdfSource.id));
 const failedUpgrade=await b.req('books/'+bookB.id+'/structure','POST');await waitJob(b,bookB.id,failedUpgrade.id,'failed');check((await b.req('books/'+bookB.id)).chapters[0].id===detailB.chapters[0].id,'原文匹配失败时回滚并保留旧目录');
 await db.update(sources).set({text:pdfSource.text}).where(eq(sources.id,pdfSource.id));await b.req('jobs/'+failedUpgrade.id+'/retry','POST');await waitJob(b,bookB.id,failedUpgrade.id);check((await b.req('books/'+bookB.id)).structureVersion===1,'无模型账号也可以重试目录更新');
 console.log(`PostgreSQL 集成验证通过：${checks} 项检查；${calls} 次本地协议模拟调用。未验证真实模型质量。`);
}catch(error){console.error(error);console.error(output.slice(-3500));process.exitCode=1}finally{
 app.kill('SIGTERM');mock.close();

 await client.end();
 await new Promise<void>(resolve=>{if(app.exitCode!==null||app.signalCode!==null)resolve();else app.once('exit',()=>resolve())});
 await admin.unsafe('DROP DATABASE '+database+' WITH (FORCE)');await admin.end();await rm(uploadDir,{recursive:true,force:true});
}
