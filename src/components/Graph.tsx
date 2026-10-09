'use client';
import { useEffect,useRef,useState } from 'react';
import type { z } from 'zod';
import { graphSchema,compileGraph } from '../modules/ai/validation';
import type { Citation } from '../lib/schema';
type GraphData=z.infer<typeof graphSchema>;
type Mermaid={initialize:(options:unknown)=>void;parse:(source:string)=>Promise<unknown>;render:(id:string,source:string)=>Promise<{svg:string}>};
declare global{interface Window{mermaid?:Mermaid}}
let loader:Promise<Mermaid>|null=null;let chain=Promise.resolve();let counter=0;
function loadMermaid(){if(!loader)loader=new Promise((resolve,reject)=>{if(window.mermaid)return resolve(window.mermaid);const script=document.createElement('script');script.src='/mermaid.min.js';script.onload=()=>window.mermaid?resolve(window.mermaid):reject(new Error('图谱渲染器加载失败'));script.onerror=()=>reject(new Error('图谱渲染器加载失败'));document.head.append(script)});return loader}
function download(name:string,data:string,type:string){const href=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),500)}
export default function Graph({graph,onCitation}:{graph:GraphData;onCitation:(citation:Citation)=>void}){
  const [direction,setDirection]=useState<'TB'|'LR'>('TB');const original=compileGraph(graph,direction);
  const [code,setCode]=useState(original),[applied,setApplied]=useState(original),[svg,setSvg]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0);const host=useRef<HTMLDivElement>(null);
  const edited=code!==original;const valid=!!svg&&code===applied;
  useEffect(()=>{setCode(original);setApplied(original)},[original]);
  useEffect(()=>{let stopped=false;setSvg('');setError('');const source=applied;
    const render=async()=>{try{
      if(source.length>18000||!/^\s*(flowchart|graph)\s+(TB|TD|LR|RL|BT)\b/.test(source)||/%%\{|^\s*---|^\s*(click|link|href)\s|javascript\s*:|https?\s*:|<[a-z!\/]|@\{|\]\(/im.test(source))throw new Error('请使用基础 flowchart 语法；不接受指令、HTML、链接或外部资源');
      const mermaid=await loadMermaid();mermaid.initialize({startOnLoad:false,securityLevel:'strict',maxTextSize:18000,maxEdges:100,suppressErrorRendering:true,theme:'base',flowchart:{htmlLabels:false},themeVariables:{fontFamily:'PingFang SC, sans-serif',primaryColor:'#e6eddf',primaryTextColor:'#253d2e',lineColor:'#53725b'}});
      await mermaid.parse(source);const rendered=await mermaid.render('reador-map-'+(++counter),source);if(!stopped)setSvg(rendered.svg);
    }catch(error){if(!stopped)setError(error instanceof Error?error.message:'图谱渲染失败')}};
    chain=chain.then(render,render);return()=>{stopped=true};
  },[applied,revision]);
  useEffect(()=>{if(!host.current||!svg||edited)return;graph.nodes.forEach((node,index)=>{const dom=[...host.current!.querySelectorAll('.node')].find(element=>element.getAttribute('data-id')==='c'+index||element.id.includes('-c'+index+'-'));if(dom){dom.setAttribute('tabindex','0');dom.setAttribute('role','button');dom.setAttribute('aria-label','查看'+node.label+'的原文');(dom as HTMLElement).onclick=()=>onCitation(node.citations[0]);(dom as HTMLElement).onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onCitation(node.citations[0])}}}})},[svg,edited,graph,onCitation]);
  return <div className="graph-workbench">
    <div className="row spread"><label>布局 <select value={direction} onChange={event=>{if(edited){setError('请先导出修改或恢复原版，再切换布局');return}setDirection(event.target.value as 'TB'|'LR')}}><option value="TB">纵向</option><option value="LR">横向</option></select></label><span className="muted">{graph.nodes.length} 个概念 · {graph.edges.length} 条关系</span></div>
    {error&&<p className="error" role="alert">{error}</p>}
    {svg?<div ref={host} className="graph-canvas" dangerouslySetInnerHTML={{__html:svg}}/>:<p className="empty">{error?'请修正源码后重新校验':'正在渲染…'}</p>}
    <details><summary>查看 / 编辑 Mermaid 源码</summary><textarea aria-label="Mermaid 源码" value={code} maxLength={18000} onChange={event=>{setCode(event.target.value);setSvg('')}} rows={9}/><div className="row"><button onClick={()=>{setApplied(code);setRevision(value=>value+1)}}>校验并更新</button><button className="outline" onClick={()=>{setCode(original);setApplied('');setTimeout(()=>setApplied(original),0)}}>恢复原版</button></div></details>
    {edited?<p className="notice">手动版本：来源对应关系待核对，不沿用原图引用。语法通过不代表内容正确。</p>:<details className="graph-evidence-details"><summary>概念、关系与原文依据</summary><div className="graph-evidence">{graph.nodes.map(node=><article key={node.id}><h3>{node.label}</h3><p>{node.definition}</p>{node.citations.map((citation,index)=><button className="citation" key={index} onClick={()=>onCitation(citation)}>“{citation.quote}” · 查看原文 →</button>)}</article>)}{graph.edges.map((edge,index)=><article key={index}><p>{graph.nodes.find(node=>node.id===edge.source)?.label} — {edge.label} → {graph.nodes.find(node=>node.id===edge.target)?.label}（{edge.type}）</p>{edge.citations.map((citation,j)=><button className="citation" key={j} onClick={()=>onCitation(citation)}>依据：“{citation.quote}” →</button>)}</article>)}</div></details>}
    {graph.warnings.length>0&&<details className="graph-warning-details"><summary>范围与生成说明 · {graph.warnings.length}</summary>{graph.warnings.map((warning,index)=><p className="notice" key={index}>{warning}</p>)}</details>}
    <div className="row"><button className="outline" disabled={!valid} onClick={()=>download('概念图.mmd',code,'text/plain')}>导出 .mmd</button><button className="outline" disabled={!valid} onClick={()=>download('概念图.svg',svg,'image/svg+xml')}>导出 SVG</button><button className="outline" disabled={!valid} onClick={()=>download('概念图.md','```mermaid\n'+code+'\n```\n'+(edited?'手动修改，来源待核对':graph.nodes.map(node=>'- '+node.label+'：'+node.citations.map(citation=>citation.quote+'（'+citation.sourceId+'）').join('；')).join('\n')+'\n'+graph.edges.map(edge=>'- '+edge.label+'：'+edge.citations.map(citation=>citation.quote+'（'+citation.sourceId+'）').join('；')).join('\n')),'text/markdown')}>导出 Markdown</button></div>
  </div>;
}
