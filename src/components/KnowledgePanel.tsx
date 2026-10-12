'use client';
import { useEffect,useState } from 'react';
import { api,errorText } from './api';
import type { Citation } from '../lib/schema';
import type { BookKnowledge } from './types';
const kindLabel={conceptual:'概念',procedural:'方法',representational:'表征',language:'语言',meta:'学习策略'};
const statusLabel={untested:'尚无独立检测记录',needs_practice:'最近独立作答需练习',recalling:'最近独立作答达到得分要求'};
export default function KnowledgePanel({bookId,onCitation}:{bookId:string;onCitation:(citation:Citation)=>void}){
  const [open,setOpen]=useState(false),[knowledge,setKnowledge]=useState<BookKnowledge|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[limit,setLimit]=useState(20);
  useEffect(()=>{setKnowledge(null);setError('');setQuery('');setLimit(20)},[bookId]);
  useEffect(()=>{if(!open||!bookId)return;let stopped=false;
    const load=()=>void api<BookKnowledge>('books/'+bookId+'/concepts').then(value=>{if(!stopped){setKnowledge(value);setError('')}}).catch(error=>{if(!stopped)setError(errorText(error))});
    load();const timer=setInterval(load,5000);return()=>{stopped=true;clearInterval(timer)};
  },[bookId,open]);
  const filtered=knowledge?.concepts.filter(concept=>concept.label.includes(query)||concept.definition.includes(query))||[];
  return <section className="panel knowledge-panel"><details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>书籍知识点与学习路径{knowledge?' · '+knowledge.concepts.length+' 个知识点':''}</summary>
    {open&&<><p className="muted small">查看定义、掌握标准和原文会记录为本轮学习辅助。检测记录只反映已有作答，不代表长期掌握。</p>
      {error&&<p className="error" role="alert">{error}</p>}
      {!knowledge?<p role="status">正在载入知识点…</p>:!knowledge.concepts.length?<p className="empty">生成新版概念图或章节练习后，这里会显示带原文依据的知识点和掌握标准。旧图谱、题目与复习历史仍保留。</p>:<>
        <label>查找知识点<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setLimit(20)}} placeholder="输入名称或定义"/></label>
        <div className="knowledge-list">{filtered.slice(0,limit).map(concept=><details className="knowledge-item" key={concept.id}><summary>{concept.label} <span className="badge">{kindLabel[concept.kind]}</span></summary>
          <p>{concept.definition}</p><p className="muted small">{statusLabel[concept.evidence.status]} · {concept.evidence.independent} 次独立作答 · {concept.evidence.assisted} 次辅助作答 · {concept.evidence.remedial} 次即时补救 · {concept.questionCount} 道正式题目</p>
          <h3>掌握标准</h3>{concept.masteryCriteria.map((criterion,index)=><article key={index}><p>{criterion.text}</p>{criterion.citations.map((citation,j)=><button className="citation" key={j} onClick={()=>onCitation(citation)}>“{citation.quote}” · 核对原文 →</button>)}</article>)}
          <h3>概念原文依据</h3>{concept.citations.map((citation,index)=><button className="citation" key={index} onClick={()=>onCitation(citation)}>“{citation.quote}” · 查看原文 →</button>)}
          <h3>先修知识</h3>{!knowledge.dependencies.some(edge=>edge.conceptId===concept.id)?<p className="muted small">尚无通过校验的先修关系，不推断为没有先修要求。</p>:knowledge.dependencies.filter(edge=>edge.conceptId===concept.id).map(edge=><article key={edge.id}><strong>{knowledge.concepts.find(node=>node.id===edge.prerequisiteId)?.label} · {edge.strength==='hard'?'必需基础':'有帮助的基础'}</strong><p>{edge.reason}</p>{edge.citations.map((citation,index)=><button className="citation" key={index} onClick={()=>onCitation(citation)}>“{citation.quote}” · 关系依据 →</button>)}</article>)}
        </details>)}</div>{filtered.length>limit&&<button className="outline" onClick={()=>setLimit(limit+20)}>显示更多知识点</button>}{!filtered.length&&<p className="empty">没有匹配的知识点。</p>}
      </>}
    </>}
  </details></section>;
}
