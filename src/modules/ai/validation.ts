import { z } from 'zod';
import type { Rubric } from '../../lib/schema';
import { assert,AppError } from '../../lib/errors';
export const citationSchema=z.object({sourceId:z.uuid(),quote:z.string().min(2).max(600)}).strict();
const citations=z.array(citationSchema).min(1).max(8);
export const graphSchema=z.object({nodes:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),label:z.string().min(1).max(60),definition:z.string().min(1).max(600),citations}).strict()).max(12),edges:z.array(z.object({source:z.string(),target:z.string(),type:z.enum(['is_a','part_of','contrasts_with','requires','causes','supports','followed_by','tests']),label:z.string().min(1).max(50),citations}).strict()).max(20),warnings:z.array(z.string().max(300)).max(10)}).strict();
export const summarySchema=z.object({items:z.array(z.object({title:z.string().min(1).max(100),text:z.string().min(1).max(1800),citations}).strict()).min(1).max(8)}).strict();
export const questionSchema=z.object({questions:z.array(z.object({goal:z.string().min(1).max(200),prompt:z.string().min(5).max(1500),answer:z.string().min(5).max(2400),rubric:z.array(z.object({point:z.string().min(1).max(400),weight:z.number().int().min(1).max(100)}).strict()).min(1).max(8),citations}).strict()).min(1).max(3)}).strict();
export const replySchema=z.object({answer:z.string().min(1).max(8000),insufficient:z.boolean(),citations:z.array(citationSchema).max(8)}).strict().refine(result=>result.insufficient||result.citations.length>0,{message:'有事实结论时必须附原文引用'});
export const assessmentSchema=z.object({points:z.array(z.object({index:z.number().int().min(0),earned:z.number().min(0).max(100),feedback:z.string().min(1).max(700)}).strict()).min(1).max(8),feedback:z.string().min(1).max(3000),recommendation:z.enum(['Again','Hard','Good','Easy']),citations}).strict();
export type Source={id:string;text:string};
export type CitationIssue={path:string;reason:'unknown_source'|'quote_mismatch'};
function citationLocation(path:string){const match=/^(nodes|edges|items|questions)\[(\d+)\]\.citations\[(\d+)\]$/.exec(path);return match?({nodes:'概念',edges:'关系',items:'条目',questions:'题目'}[match[1]]||'条目')+' '+(Number(match[2])+1)+' 的引用 '+(Number(match[3])+1):'引用'}
export class CitationValidationError extends AppError{
  constructor(public issues:CitationIssue[]){super(422,'模型引用校验失败：'+issues.map(issue=>citationLocation(issue.path)+'（'+(issue.reason==='unknown_source'?'来源不在本批范围':'摘录与原文不逐字匹配')+'）').join('；'))}
}
export function validateCitations(data:unknown,sources:Source[]){
  const allowed=new Map(sources.map(source=>[source.id,source.text])),issues:CitationIssue[]=[];
  function visit(value:unknown,path:string){
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach((item,index)=>visit(item,path+'['+index+']'));return}
    const record=value as Record<string,unknown>;
    if('sourceId'in record&&'quote'in record){const citation=record as {sourceId:string;quote:string};const text=allowed.get(citation.sourceId);if(text===undefined)issues.push({path,reason:'unknown_source'});else if(typeof citation.quote!=='string'||!text.includes(citation.quote))issues.push({path,reason:'quote_mismatch'})}
    Object.entries(record).forEach(([key,item])=>visit(item,path?path+'.'+key:key));
  }
  visit(data,'');if(issues.length)throw new CitationValidationError(issues);
}
export function validateGraph(graph:z.infer<typeof graphSchema>){const ids=new Set(graph.nodes.map(node=>node.id));assert(ids.size===graph.nodes.length,422,'图谱概念 ID 重复');graph.edges.forEach(edge=>assert(ids.has(edge.source)&&ids.has(edge.target)&&edge.source!==edge.target,422,'概念关系端点无效'))}
export function validateRubric(rubric:Rubric[]){assert(rubric.reduce((sum,item)=>sum+item.weight,0)===100,422,'题目评分要点权重之和必须为 100')}
export function assess(data:z.infer<typeof assessmentSchema>,rubric:Rubric[]){
  assert(data.points.length===rubric.length,422,'评分要点不完整');const indices=new Set<number>();let score=0;
  for(const point of data.points){assert(point.index<rubric.length&&!indices.has(point.index),422,'评分要点重复或不存在');indices.add(point.index);assert(point.earned<=rubric[point.index].weight,422,'得分超过评分要点权重');score+=point.earned}
  assert(score<=100,422,'评分超出范围');return {...data,score,recommendation:score<60?'Again' as const:data.recommendation};
}
function escapeLabel(text:string){return text.replace(/["<>\[\]{}|`\n\r]/g,' ').replace(/&/g,'和').replace(/\d+\.\s/g,'').trim()}
export function compileGraph(graph:z.infer<typeof graphSchema>,direction:'TB'|'LR'='TB'){
  validateGraph(graph);const ids=new Map(graph.nodes.map((node,index)=>[node.id,'c'+index]));
  return ['flowchart '+direction,...graph.nodes.map(node=>`  ${ids.get(node.id)}["${escapeLabel(node.label)}"]`),...graph.edges.map(edge=>`  ${ids.get(edge.source)} -->|"${escapeLabel(edge.label)}"| ${ids.get(edge.target)}`),'  classDef concept fill:#e6eddf,stroke:#53725b,color:#253d2e',...(graph.nodes.length?['  class '+[...ids.values()].join(',')+' concept']:[])].join('\n');
}
