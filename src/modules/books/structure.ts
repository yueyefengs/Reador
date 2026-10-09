import { posix } from 'node:path';
export const STRUCTURE_VERSION=1;
export type StructureOrigin='toc'|'outline'|'heading'|'page'|'file'|'legacy';
export type Block={text:string;locator:{page?:number;href?:string;paragraph:number}};
export type ParsedChapter={title:string;inferred:boolean;origin:StructureOrigin;depth:number;blocks:Block[]};
export type Boundary={title:string;start:number;depth:number};
// 目录只允许指向归档内文件，不请求远程内容，也不接受编码后的路径穿越。
export function localTarget(base:string,href:string){
  try{
    if(!href||/^[a-z][\w+.-]*:/i.test(href)||href.startsWith('//'))return null;
    const hash=href.indexOf('#'),file=decodeURIComponent(hash<0?href:href.slice(0,hash)),anchor=hash<0?'':decodeURIComponent(href.slice(hash+1));
    if(file.startsWith('/')||file.includes('\\')||file.includes('\0')||anchor.includes('\0'))return null;
    const path=file?posix.normalize(posix.join(posix.dirname(base),file)):base;
    if(path==='..'||path.startsWith('../')||path.startsWith('/'))return null;
    return {path,anchor};
  }catch{return null}
}
// 父目录的范围包含其后连续的子目录，多个范围取并集，来源不重复。
export function chapterScope<T extends {id:string;depth:number}>(catalog:T[],ids:string[]){
  const selected=new Set<string>();
  for(const [index,chapter] of catalog.entries())if(ids.includes(chapter.id)){
    selected.add(chapter.id);
    for(let next=index+1;next<catalog.length&&catalog[next].depth>chapter.depth;next++)selected.add(catalog[next].id);
  }
  return selected;
}
export function groupBlocks(blocks:Block[],boundaries:Boundary[],origin:'toc'|'outline'):ParsedChapter[]{
  const chapters:ParsedChapter[]=[];
  if(boundaries[0].start>0)chapters.push({title:'目录前正文',inferred:true,origin:'file',depth:0,blocks:blocks.slice(0,boundaries[0].start)});
  for(const [index,boundary] of boundaries.entries())chapters.push({title:boundary.title,depth:boundary.depth,origin,inferred:false,blocks:blocks.slice(boundary.start,boundaries[index+1]?.start??blocks.length)});
  return chapters;
}
