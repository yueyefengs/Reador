import { and,asc,eq,sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { concepts,conceptOrigins,conceptDependencies,questions,attempts,reviewCards,type Citation,type MasteryCriterion } from '../../lib/schema';
import { assert } from '../../lib/errors';
import { graphSchema,knowledgeConceptSchema,hasPrerequisiteCycle,validateCitations,validateGraph,type Source } from '../ai/validation';
import { conceptIdentity,sameConcept } from './identity';
type Transaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope={ownerId:string;bookId:string;jobId:string};
type Concept=typeof concepts.$inferSelect;
export type LearningEvidence={status:'untested'|'needs_practice'|'recalling';independent:number;assisted:number;remedial:number;latestScore:number|null};
export function learningEvidence(rows:Pick<typeof attempts.$inferSelect,'assessment'|'assisted'|'kind'|'ratedAt'|'createdAt'|'answer'>[]):LearningEvidence{
  const graded=rows.filter(row=>row.assessment).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime());
  const independent=graded.filter(row=>!row.assisted&&row.kind!=='remedy');
  const latest=independent[0];
  return {status:!latest?'untested':latest.assessment!.score<60||latest.answer==='暂时想不起来'?'needs_practice':'recalling',independent:independent.length,assisted:graded.filter(row=>row.assisted&&row.kind!=='remedy').length,remedial:graded.filter(row=>row.kind==='remedy').length,latestScore:latest?.assessment?.score??null};
}
export async function lockConceptBook(tx:Transaction,scope:{ownerId:string;bookId:string}){
  // 按书串行登记，避免并行任务为同一知识点分配不同身份或共同引入循环。
  await tx.execute(sql`select id from books where id=${scope.bookId} and owner_id=${scope.ownerId} for update`);
}
export function distinctCitations(values:Citation[]){return [...new Map(values.map(value=>[JSON.stringify([value.sourceId,value.quote]),value])).values()]}
export function mergeMasteryCriteria(values:MasteryCriterion[]){
  const criteria=new Map<string,MasteryCriterion>();
  for(const value of values){const prior=criteria.get(value.text);criteria.set(value.text,{text:value.text,citations:distinctCitations([...(prior?.citations||[]),...value.citations])})}
  return [...criteria.values()];
}
export async function saveConcept(tx:Transaction,scope:Scope,originKey:string,input:unknown,allowed:Source[],requestedId?:string|null){
  const value=knowledgeConceptSchema.parse(input);validateCitations(value,allowed);
  const [origin]=await tx.select().from(conceptOrigins).where(and(eq(conceptOrigins.jobId,scope.jobId),eq(conceptOrigins.originKey,originKey),eq(conceptOrigins.ownerId,scope.ownerId),eq(conceptOrigins.bookId,scope.bookId)));
  if(origin)return origin.conceptId;
  const identity=conceptIdentity(value);
  const existing=await tx.select().from(concepts).where(and(eq(concepts.ownerId,scope.ownerId),eq(concepts.bookId,scope.bookId)));
  const matches=existing.filter(concept=>sameConcept(concept,value));
  const requested=requestedId?existing.find(concept=>concept.id===requestedId):null;
  if(requestedId)assert(requested&&sameConcept(requested,value),422,'题目知识点不属于当前书籍或原文范围');
  let concept=requested||(matches.length===1?matches[0]:existing.find(concept=>concept.identityKey===identity.identityKey));
  if(concept){
    const [updated]=await tx.update(concepts).set({citations:distinctCitations([...concept.citations,...value.citations]),masteryCriteria:mergeMasteryCriteria([...concept.masteryCriteria,...value.masteryCriteria])}).where(eq(concepts.id,concept.id)).returning();concept=updated;
  }else{[concept]=await tx.insert(concepts).values({ownerId:scope.ownerId,bookId:scope.bookId,...identity,...value}).returning()}
  await tx.insert(conceptOrigins).values({...scope,originKey,conceptId:concept.id,snapshot:value});
  return concept.id;
}
export async function registerGraph(tx:Transaction,scope:Scope,batch:number,input:unknown,allowed:Source[]){
  const graph=graphSchema.parse(input);validateCitations(graph,allowed);validateGraph(graph);
  const ids=new Map<string,string>();
  for(const node of graph.nodes){
    // 历史图谱缺少掌握标准时仍可阅读，不伪造标准或追溯修改历史。
    if(!node.kind||!node.masteryCriteria?.length)continue;
    const conceptId=await saveConcept(tx,scope,`graph:${batch}:${node.id}`,{label:node.label,definition:node.definition,kind:node.kind,masteryCriteria:node.masteryCriteria,citations:node.citations},allowed);
    ids.set(node.id,conceptId);node.conceptId=conceptId;
  }
  const existing=await tx.select().from(conceptDependencies).where(and(eq(conceptDependencies.ownerId,scope.ownerId),eq(conceptDependencies.bookId,scope.bookId)));
  const accepted:typeof graph.edges=[];
  for(const edge of graph.edges){
    if(edge.type!=='requires'){accepted.push(edge);continue}
    const conceptId=ids.get(edge.source),prerequisiteId=ids.get(edge.target);
    if(!conceptId||!prerequisiteId){accepted.push(edge);continue}
    assert(edge.strength,422,'先修关系缺少强弱类型');
    if(conceptId===prerequisiteId||hasPrerequisiteCycle([...existing,{conceptId,prerequisiteId}])){
      graph.warnings=[...graph.warnings,'一条先修关系与已有学习路径形成循环，已移除；请核对原文。'].slice(0,10);continue;
    }
    if(!existing.some(item=>item.conceptId===conceptId&&item.prerequisiteId===prerequisiteId)){
      const [saved]=await tx.insert(conceptDependencies).values({...scope,conceptId,prerequisiteId,strength:edge.strength,reason:edge.label,citations:edge.citations}).returning();existing.push(saved);
    }
    accepted.push(edge);
  }
  graph.edges=accepted;return graph;
}
export async function bookKnowledge(ownerId:string,bookId:string){
  const scope=and(eq(concepts.ownerId,ownerId),eq(concepts.bookId,bookId));
  const [nodes,dependencies,questionRows,records,cards]=await Promise.all([
    db.select().from(concepts).where(scope).orderBy(asc(concepts.createdAt),asc(concepts.id)),
    db.select().from(conceptDependencies).where(and(eq(conceptDependencies.ownerId,ownerId),eq(conceptDependencies.bookId,bookId))).orderBy(asc(conceptDependencies.createdAt)),
    db.select({id:questions.id,conceptId:questions.conceptId,remedyOf:questions.remedyOf}).from(questions).where(and(eq(questions.ownerId,ownerId),eq(questions.bookId,bookId))),
    db.select().from(attempts).where(and(eq(attempts.ownerId,ownerId),eq(attempts.bookId,bookId))),
    db.select({questionId:reviewCards.questionId}).from(reviewCards).where(and(eq(reviewCards.ownerId,ownerId),eq(reviewCards.bookId,bookId)))
  ]);
  const questionConcept=new Map(questionRows.map(question=>[question.id,question.conceptId]));
  return {concepts:nodes.map(concept=>({...concept,evidence:learningEvidence(records.filter(record=>questionConcept.get(record.questionId)===concept.id)),questionCount:questionRows.filter(question=>question.conceptId===concept.id&&!question.remedyOf).length,cardCount:cards.filter(card=>questionConcept.get(card.questionId)===concept.id).length})),dependencies};
}
export async function conceptCandidates(ownerId:string,bookId:string,sourceIds:string[]){
  const rows=await db.select().from(concepts).where(and(eq(concepts.ownerId,ownerId),eq(concepts.bookId,bookId)));
  return rows.filter(concept=>concept.citations.some(citation=>sourceIds.includes(citation.sourceId))).slice(0,30).map(concept=>({id:concept.id,label:concept.label,definition:concept.definition,kind:concept.kind,citations:concept.citations.filter(citation=>sourceIds.includes(citation.sourceId)).slice(0,8),masteryCriteria:concept.masteryCriteria.map(criterion=>({...criterion,citations:criterion.citations.filter(citation=>sourceIds.includes(citation.sourceId)).slice(0,8)})).filter(criterion=>criterion.citations.length).slice(0,5)}));
}
export async function remedialRecommendations(ownerId:string,attemptId:string){
  const [attempt]=await db.select().from(attempts).where(and(eq(attempts.id,attemptId),eq(attempts.ownerId,ownerId)));assert(attempt,404,'作答记录不存在');assert(attempt.assessment,422,'完成评分后才能查看补救建议');
  const [question]=await db.select().from(questions).where(and(eq(questions.id,attempt.questionId),eq(questions.ownerId,ownerId),eq(questions.bookId,attempt.bookId)));assert(question,404,'题目不存在');
  if(!question.conceptId||attempt.assessment.score>=60&&!attempt.assisted&&attempt.answer!=='暂时想不起来')return [];
  const knowledge=await bookKnowledge(ownerId,attempt.bookId);
  const edges=knowledge.dependencies.filter(edge=>edge.conceptId===question.conceptId).sort((a,b)=>Number(b.strength==='hard')-Number(a.strength==='hard'));
  return edges.flatMap(edge=>{
    const concept=knowledge.concepts.find(concept=>concept.id===edge.prerequisiteId);
    if(!concept||concept.evidence.status==='recalling')return [];
    return [{concept,dependency:edge,explanation:concept.evidence.status==='needs_practice'?'这个先修知识点的最近独立作答需要练习，可先回看依据再检测。':'这个先修知识点尚无独立作答证据，建议先检查；这不代表已经判断你不会。'}];
  }).slice(0,5);
}
export async function ownedConcept(ownerId:string,bookId:string,id:string):Promise<Concept>{
  const [concept]=await db.select().from(concepts).where(and(eq(concepts.id,id),eq(concepts.ownerId,ownerId),eq(concepts.bookId,bookId)));assert(concept,404,'知识点不属于当前书籍');return concept;
}
