import { callModel,type AgentConfig } from './provider';
import { graphSchema,validateGraph,CitationValidationError,type Source } from './validation';
const instruction='提取本批核心概念及原文明确支持的有类型关系。最多 6 个节点、8 条关系，不必填满。定义不超过 60 字；每项只需 1 个引用，逐字 quote 不超过 40 字。引用须先从单个 source.text 复制一段连续短句，再配对该 sourceId；不要改写标点、空格，不加省略号，不跨片段拼接。优先完整输出精简 JSON，不强行覆盖所有细节。不足则返回空图与 warnings。';
export async function generateGraph(config:AgentConfig,sources:Source[],signal?:AbortSignal){
  const input={sources:sources.map(source=>({sourceId:source.id,text:source.text}))};
  try{const graph=await callModel(config,instruction,graphSchema,input,sources,signal);validateGraph(graph);return graph}
  catch(error){
    if(!(error instanceof CitationValidationError)||signal?.aborted)throw error;
    // 仅针对引用错误重生成一次；第二次仍执行同样的严格校验。
    const graph=await callModel(config,instruction+'上一次引用校验未通过，请重新生成。只使用本次 sources 的 ID 和逐字连续短句，无法确认的概念或关系请省略。',graphSchema,{...input,citationErrors:error.issues},sources,signal);
    validateGraph(graph);return graph;
  }
}
