import { callModel,type AgentConfig } from './provider';
import { learningGraphSchema,validateGraph,CitationValidationError,type Source } from './validation';
import { assert } from '../../lib/errors';
import type { ConceptCandidate } from './questions';
const instruction='提取本批核心概念及原文明确支持的有类型关系。最多 6 个节点、8 条关系，不必填满。每个节点包含 kind 类型和 1 到 3 条 masteryCriteria：用可观察的解释、辨别或应用行为描述掌握标准，每条含 text 与原文 citations，不使用抽象的“掌握了”。掌握标准不是参考答案或用户的当前能力。已有匹配候选时沿用其 label 和 kind，仍从本次 sources 提取依据。requires 的方向为 source 依赖 target，仅在原文直接说明先修能力或前提时生成，引用须包含直接表达依赖的完整句；必须给出 strength（hard 必需 / soft 有帮助）、简短 label 理由及引用。操作步骤先后使用 followed_by，不得把先后顺序、概念包含、练习触发条件或一般相关关系冒充知识先修；先修关系不得有环。定义不超过 60 字；每项只需 1 个引用，逐字 quote 不超过 40 字。引用须先从单个 source.text 复制一段连续短句，再配对该 sourceId；不要改写标点、空格，不加省略号，不跨片段拼接。优先完整输出精简 JSON，不强行覆盖所有细节。不足则返回空图与 warnings。';
export async function generateGraph(config:AgentConfig,sources:Source[],signal?:AbortSignal,existingConcepts:ConceptCandidate[]=[]){
  const input={sources:sources.map(source=>({sourceId:source.id,text:source.text})),existingConcepts};
  try{const graph=await callModel(config,instruction,learningGraphSchema,input,sources,signal);validateGraph(graph);validateStrength(graph);return graph}
  catch(error){
    if(!(error instanceof CitationValidationError)||signal?.aborted)throw error;
    // 仅针对引用错误重生成一次；第二次仍执行同样的严格校验。
    const graph=await callModel(config,instruction+'上一次引用校验未通过，请重新生成。只使用本次 sources 的 ID 和逐字连续短句，无法确认的概念或关系请省略。',learningGraphSchema,{...input,citationErrors:error.issues},sources,signal);
    validateGraph(graph);validateStrength(graph);return graph;
  }
}
function validateStrength(graph:ReturnType<typeof learningGraphSchema.parse>){for(const edge of graph.edges)if(edge.type==='requires')assert(edge.strength,422,'先修关系缺少强弱类型')}
