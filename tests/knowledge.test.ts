import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { conceptIdentity,sameConcept } from '../src/modules/knowledge/identity';
import { knowledgeConceptSchema,learningGraphSchema,validateCitations,validateGraph,hasPrerequisiteCycle } from '../src/modules/ai/validation';
const source={id:randomUUID(),text:'先独立回忆，再核对原文。'};
const citation={sourceId:source.id,quote:'先独立回忆'};
const concept={label:'独立回忆',definition:'从记忆中提取内容',kind:'conceptual' as const,citations:[citation],masteryCriteria:[{text:'能够解释回忆和核对的顺序',citations:[citation]}]};
describe('知识点身份与原文依据',()=>{
 it('同名同类且依据重叠才复用，定义措辞变化不改变身份',()=>{
  expect(conceptIdentity(concept)).toEqual(conceptIdentity({...concept,label:' 独立回忆 '}));
  const reworded={...concept,definition:'用自己的话提取内容'};expect(sameConcept(concept,reworded)).toBe(true);
  expect(sameConcept(concept,{...concept,citations:[{...citation,sourceId:randomUUID()}]})).toBe(false);
  expect(sameConcept(concept,{...concept,kind:'procedural'})).toBe(false);
  expect(sameConcept(concept,{...concept,label:'主动回忆'})).toBe(false);
 });
 it('身份锚点不受引用排序影响',()=>{const extra={sourceId:randomUUID(),quote:'核对'};expect(conceptIdentity({...concept,citations:[citation,extra]})).toEqual(conceptIdentity({...concept,citations:[extra,citation]}))});
 it('新版知识点必须有可观察掌握标准，且其引用也要逐字匹配',()=>{
  expect(knowledgeConceptSchema.safeParse({...concept,masteryCriteria:[]}).success).toBe(false);
  expect(()=>validateCitations({...concept,masteryCriteria:[{text:'能够解释顺序',citations:[{...citation,quote:'先看答案'}]}]},[source])).toThrow(/摘录/);
  expect(()=>validateCitations({...concept,masteryCriteria:[{text:'能够解释顺序',citations:[{...citation,sourceId:randomUUID()}]}]},[source])).toThrow(/来源/);
 });
 it('只对先修子图检查循环，不限制一般概念关系',()=>{
  const nodes=[{id:'a',...concept},{id:'b',...concept,label:'核对'}];
  const edge={source:'a',target:'b',type:'requires' as const,label:'依赖',strength:'hard' as const,citations:[citation]};
  expect(()=>validateGraph(learningGraphSchema.parse({nodes,edges:[edge,{...edge,source:'b',target:'a'}],warnings:[]}))).toThrow(/循环/);
  expect(()=>validateGraph({nodes,edges:[{...edge,type:'supports'},{...edge,source:'b',target:'a',type:'supports'}],warnings:[]})).not.toThrow();
  expect(hasPrerequisiteCycle([{conceptId:'a',prerequisiteId:'b'},{conceptId:'b',prerequisiteId:'c'},{conceptId:'c',prerequisiteId:'a'}])).toBe(true);
 });
});

describe('题目知识点关联',()=>{
 it('只能引用给定候选，拒绝跨范围 ID 和名称或类型不匹配',async()=>{
  const {validateQuestionConcepts}=await import('../src/modules/ai/questions');
  const {learningQuestionSchema}=await import('../src/modules/ai/validation');
  const candidate={id:randomUUID(),...concept};
  const question={conceptId:candidate.id,concept,goal:'解释回忆顺序',prompt:'为什么先回忆再核对？',answer:'先独立提取，再核对材料。',rubric:[{point:'说明顺序',weight:100}],citations:[citation]};
  const parse=(value:typeof question)=>learningQuestionSchema.parse({questions:[value]});
  expect(()=>validateQuestionConcepts(parse(question),[candidate])).not.toThrow();
  expect(()=>validateQuestionConcepts(parse({...question,conceptId:randomUUID()}),[candidate])).toThrow(/候选范围/);
  expect(()=>validateQuestionConcepts(parse({...question,concept:{...concept,label:'另一概念'}}),[candidate])).toThrow(/不匹配/);
 });
});

describe('知识点累计证据',()=>{
 it('引用去重忽略 JSON 对象键顺序，相同标准合并来源',async()=>{
  const {distinctCitations,mergeMasteryCriteria}=await import('../src/modules/knowledge/service');
  const reordered={quote:citation.quote,sourceId:citation.sourceId};
  expect(distinctCitations([citation,reordered])).toHaveLength(1);
  const extra={sourceId:randomUUID(),quote:'核对原文'};
  const criteria=mergeMasteryCriteria([{text:'说明顺序',citations:[citation]},{text:'说明顺序',citations:[reordered,extra]}]);
  expect(criteria).toHaveLength(1);expect(criteria[0].citations).toHaveLength(2);
 });
 it('辅助与即时补救不冒充独立回忆；没有独立记录保持未检测',async()=>{
  const {learningEvidence}=await import('../src/modules/knowledge/service');
  const base={assessment:{points:[],score:100,feedback:'已回答',recommendation:'Good' as const,citations:[]},assisted:true,kind:'study',ratedAt:null,createdAt:new Date('2026-10-12T00:00:00Z'),answer:'回答'};
  expect(learningEvidence([base,{...base,assisted:false,kind:'remedy'}])).toMatchObject({status:'untested',independent:0,assisted:1,remedial:1});
  expect(learningEvidence([{...base,assisted:false,assessment:{...base.assessment,score:20}},{...base,kind:'remedy',createdAt:new Date('2026-10-12T01:00:00Z')}])).toMatchObject({status:'needs_practice',independent:1,remedial:1,latestScore:20});
 });
});
