import { assert } from '../../lib/errors';
export const SOURCE_BATCH_CHARACTERS=10_000;
// 保留片段身份及顺序，批次不截断引用；图片和原始文件不进入模型请求。
export function batchSources(sources:{id:string;text:string}[],max=SOURCE_BATCH_CHARACTERS){
  assert(Number.isInteger(max)&&max>0,422,'分批大小无效');
  const batches:string[][]=[];let batch:string[]=[],size=0;
  for(const source of sources){
    assert(source.text.length<=max,422,'原文片段超过单批限额，请检查解析结果');
    if(size+source.text.length>max&&batch.length){batches.push(batch);batch=[];size=0}
    batch.push(source.id);size+=source.text.length;
  }
  if(batch.length)batches.push(batch);
  return batches;
}
