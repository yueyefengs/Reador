'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { api,post,errorText } from './api';
import type { Book,Chapter,Artifact,Job } from './types';
import type { Citation } from '../lib/schema';
import { graphSchema } from '../modules/ai/validation';
import Graph from './Graph';
const statusLabel:Record<string,string>={queued:'等待生成',running:'正在生成',ready:'已完成',partial:'部分完成',failed:'生成失败',cancelled:'已取消'};
export default function GraphHub({books,bookId,detailId,timezone,onBook,onOpen,onCitation,onGenerate}:{books:Book[];bookId:string;detailId:string|null;timezone:string;onBook:(id:string)=>void;onOpen:(id:string|null)=>void;onCitation:(citation:Citation)=>void;onGenerate:(kind:string,ids:string[])=>Promise<void>}){
  const [artifacts,setArtifacts]=useState<Artifact[]>([]),[jobs,setJobs]=useState<Job[]>([]),[chapters,setChapters]=useState<Chapter[]>([]),[scope,setScope]=useState('all'),[batch,setBatch]=useState('overview'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const live=useRef(true);
  const refresh=useCallback(async()=>{if(!bookId)return;const [all,status]=await Promise.all([api<Artifact[]>('books/'+bookId+'/artifacts'),api<Job[]>('books/'+bookId+'/jobs')]);if(live.current){setArtifacts(all.filter(item=>item.kind==='graph'));setJobs(status.filter(job=>job.kind==='graph'));setLoading(false)}},[bookId]);
  useEffect(()=>{live.current=true;if(!bookId){setLoading(false);return}void api<{chapters:Chapter[]}>('books/'+bookId).then(book=>{if(live.current)setChapters(book.chapters)}).catch(error=>{if(live.current)setError(errorText(error))});const load=()=>void refresh().catch(error=>{if(live.current){setError(errorText(error));setLoading(false)}});load();const timer=setInterval(load,3500);return()=>{live.current=false;clearInterval(timer)}},[bookId,refresh]);
  useEffect(()=>{setBatch('overview')},[detailId]);
  const book=books.find(book=>book.id===bookId);
  const selected=artifacts.find(item=>item.id===detailId||item.jobId===detailId);
  const job=jobs.find(item=>item.id===detailId||item.id===selected?.jobId);
  const parsed=(selected?.data as {batch:number;data:unknown}[]||[]).flatMap(item=>{const result=graphSchema.safeParse(item.data);return result.success?[{batch:item.batch,graph:result.data}]:[]}).sort((left,right)=>left.batch-right.batch);
  const combined={nodes:parsed.flatMap(item=>item.graph.nodes.map(node=>({...node,id:'b'+item.batch+'_'+node.id}))).slice(0,20),edges:parsed.flatMap(item=>item.graph.edges.map(edge=>({...edge,source:'b'+item.batch+'_'+edge.source,target:'b'+item.batch+'_'+edge.target}))),warnings:parsed.flatMap(item=>item.graph.warnings)};
  const ids=new Set(combined.nodes.map(node=>node.id));combined.edges=combined.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)).slice(0,60);
  if(parsed.reduce((sum,item)=>sum+item.graph.nodes.length,0)>20)combined.warnings.push('总览显示前 20 个概念；切换原文批次可查看完整内容。不同批次概念暂不自动合并。');
  const data=batch==='overview'?combined:parsed.find(item=>String(item.batch)===batch)?.graph;
  const visible=jobs.filter(item=>artifacts.some(artifact=>artifact.jobId===item.id)||['queued','running'].includes(item.status));
  const history=jobs.filter(item=>!visible.includes(item));
  const scopeName=(item:Job)=>item.chapterIds.length===chapters.length&&chapters.length?'全书':item.chapterIds.map(id=>chapters.find(chapter=>chapter.id===id)?.title).filter(Boolean).join('、')||'已选范围';
  const formatDate=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  async function action(operation:()=>Promise<unknown>){setBusy(true);setError('');try{await operation();await refresh()}catch(error){setError(errorText(error))}finally{setBusy(false)}}
  const card=(item:Job)=><button className="graph-card" key={item.id} onClick={()=>onOpen(item.id)}><div className="row spread"><span className="badge" data-status={item.status}>{statusLabel[item.status]||item.status}</span><span aria-hidden="true">↗</span></div><h3>{scopeName(item)}概念图</h3><p>{item.completed} / {item.total} 批完成</p><small>{formatDate(item.createdAt)} · 查看详情 →</small></button>;
  const errors=[...new Set(job?.errors.map(error=>error.message)||[])].map(message=>({message,batches:job!.errors.filter(error=>error.message===message).map(error=>error.batch<0?'任务':String(error.batch+1))}));
  return <>
    <div className="intro graph-intro"><p className="eyebrow">CONCEPT MAPS</p><h1>{detailId?book?.title||'概念图详情':'概念图谱'}</h1>{detailId&&<button className="text" onClick={()=>onOpen(null)}>← 返回图谱列表</button>}</div>
    {error&&<p className="error" role="alert">{error}</p>}
    {!detailId?<>
      <section className="panel graph-library"><div className="row spread"><label>书籍<select value={bookId} onChange={event=>onBook(event.target.value)}><option value="">选择书籍</option>{books.map(book=><option key={book.id} value={book.id}>{book.title}</option>)}</select></label><span className="muted small">{visible.length} 张概念图</span></div>
        <details className="graph-create"><summary>＋ 新建概念图</summary><div className="row graph-controls"><label>范围<select value={scope} onChange={event=>setScope(event.target.value)}><option value="all">全书</option>{chapters.map(chapter=><option key={chapter.id} value={chapter.id}>{'　'.repeat(Math.min(chapter.depth,4))+chapter.title}</option>)}</select></label><button disabled={busy||book?.status!=='ready'} onClick={()=>void action(()=>onGenerate('graph',scope==='all'?[]:[scope]))}>{busy?'正在提交…':'开始生成'}</button></div><small className="muted">所选原文会发送给默认模型，按批保存结果。</small></details>
        {loading?<p className="empty">正在载入图谱…</p>:visible.length?<div className="graph-card-grid">{visible.map(card)}</div>:<p className="empty">{bookId?'还没有概念图，展开“新建概念图”开始。':'选择一本书，查看它的概念图。'}</p>}
        {history.length>0&&<details className="graph-history"><summary>历史操作记录 · {history.length}</summary><div className="graph-card-grid">{history.map(card)}</div></details>}
      </section>
    </>:loading?<p className="empty">正在载入图谱…</p>:!job&&!selected?<section className="panel"><p className="empty">该图谱不存在，或不属于当前书籍。</p></section>:<section className="panel graph-detail">
      <div className="row spread"><div><h2>{job?scopeName(job)+'概念图':'概念图'}</h2><p className="muted small">{job&&<>{statusLabel[job.status]||job.status} · {job.completed} / {job.total} 批完成</>}</p></div><div className="row">{job&&['partial','failed'].includes(job.status)&&<button disabled={busy} onClick={()=>void action(()=>post('jobs/'+job.id+'/retry'))}>{busy?'正在提交…':'重试失败批次'}</button>}{job&&['queued','running'].includes(job.status)&&<button className="outline" disabled={busy} onClick={()=>void action(()=>post('jobs/'+job.id+'/cancel'))}>取消生成</button>}</div></div>
      {job&&['queued','running'].includes(job.status)&&<progress aria-label="图谱生成进度" max={Math.max(1,job.total)} value={job.completed}/>}
      {job?.status==='partial'&&<p className="graph-state">还有 {job.total-job.completed} 批待完成，当前展示已通过校验的内容。</p>}
      {selected&&parsed.length>0?<><div className="row"><label>展示内容<select value={batch} onChange={event=>setBatch(event.target.value)}><option value="overview">概念总览</option>{parsed.map(item=><option key={item.batch} value={item.batch}>原文批次 {item.batch+1}</option>)}</select></label></div>{data&&<Graph key={selected.id+'-'+batch} graph={data} onCitation={onCitation}/>}</>:<p className="empty">{job&&['queued','running'].includes(job.status)?'生成中，完成后将在这里显示图谱。':job?.status==='cancelled'?'此任务已取消，未生成可展示的图谱。':'暂无通过校验的概念图。'}</p>}
      {errors.length>0&&<details className="graph-history"><summary>生成记录 · {job!.errors.length} 条记录</summary>{errors.map(({message,batches})=><article className="job" key={message}><strong>批次 {batches.join('、')}</strong><p>{message}</p></article>)}</details>}
      <details><summary>生成与来源说明</summary><p>仅展示已通过结构与逐字引用校验的批次；部分完成不代表覆盖全书。点击概念可核对原文，语义仍需自行判断。</p><p>重试保留成功批次，继续使用创建任务时的模型配置；新模型配置用于新建任务。</p></details>
    </section>}
  </>;
}
