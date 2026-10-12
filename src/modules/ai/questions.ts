import { assert } from '../../lib/errors';
import type { ConceptKind,Citation,MasteryCriterion } from '../../lib/schema';
import { sameConcept } from '../knowledge/identity';
import { callModel,type AgentConfig } from './provider';
import { learningQuestionSchema,validateRubric,type Source } from './validation';
export type ConceptCandidate={id:string;label:string;definition:string;kind:ConceptKind;citations:Citation[];masteryCriteria:MasteryCriterion[]};
export function validateQuestionConcepts(data:ReturnType<typeof learningQuestionSchema.parse>,candidates:ConceptCandidate[]){
  for(const question of data.questions){
    validateRubric(question.rubric);
    assert(question.citations.some(citation=>question.concept.citations.some(evidence=>evidence.sourceId===citation.sourceId)),422,'题目与知识点必须共享原文依据');
    if(question.conceptId){const selected=candidates.find(concept=>concept.id===question.conceptId);assert(selected&&sameConcept(selected,question.concept),422,'题目引用了候选范围之外或不匹配的知识点')}
  }
}
export async function generateQuestions(config:AgentConfig,sources:Source[],existingConcepts:ConceptCandidate[]=[],signal?:AbortSignal){
  const data=await callModel(config,'为本批原文生成 1 到 3 道简答题，每题只检测一个知识点。若已有匹配候选，conceptId 必须使用其 id，并沿用其 label、kind，按其掌握标准出题；没有适用候选才将 conceptId 设为 null 并提供新 concept。每题 concept 包含 label、definition、kind、citations 和 1 到 3 条 masteryCriteria（每条包含可观察的掌握行为 text 及原文 citations）。候选只是组织提示，事实和全部引用必须来自当前 sources。goal 是该知识点的可独立检测目标，rubric 对应其掌握标准且权重合计为 100；附参考答案与引用。不得把用户当前能力或记忆状态写入知识点。',learningQuestionSchema,{sources:sources.map(source=>({sourceId:source.id,text:source.text})),existingConcepts},sources,signal);
  validateQuestionConcepts(data,existingConcepts);return data;
}
