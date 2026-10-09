import { readFile } from 'node:fs/promises';
import { join,sep } from 'node:path';
import yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';
import { assert, AppError } from '../../lib/errors';
import { pdfCover,epubCover } from './cover';
export type ParsedBook={chapters:ParsedChapter[];cover:Buffer|null};
import { localTarget,groupBlocks,type Boundary,type ParsedChapter } from './structure';
export type { ParsedChapter } from './structure';
const MAX_TEXT=2_000_000, MAX_EXPANDED=100*1024*1024;
export function splitText(text:string,max=1400){const clean=text.replace(/\u0000/g,'').trim();const result:string[]=[];for(let i=0;i<clean.length;i+=max)result.push(clean.slice(i,i+max));return result}
function checkText(chapters:ParsedChapter[]){const total=chapters.reduce((n,c)=>n+c.blocks.reduce((s,b)=>s+b.text.length,0),0);assert(total>20,422,'未提取到可阅读正文；扫描 PDF 需要 OCR，当前暂不支持');assert(total<=MAX_TEXT,422,'正文过大，首版支持最多 200 万字符，请拆分书籍');return chapters}
async function parsePdfBook(buffer:Buffer,includeCover:boolean):Promise<ParsedBook>{
  assert(buffer.subarray(0,5).toString()==='%PDF-',422,'文件内容不是有效 PDF');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  // 使用随 PDF.js 提供的标准字体，精简 Linux 容器也可绘制文字轮廓。
  // 运行目录保留完整依赖；避免构建器将 require.resolve 改写成模块编号。
  const standardFontDataUrl=join(process.cwd(),'node_modules','pdfjs-dist','standard_fonts')+sep;
  const loading=getDocument({data:new Uint8Array(buffer),useSystemFonts:false,disableFontFace:true,standardFontDataUrl});
  const doc=await loading.promise.catch(()=>{throw new AppError(422,'PDF 无法打开，可能已加密或损坏')});
  try{
    assert(doc.numPages<=800,422,'PDF 超过 800 页，请拆分后导入');
    const chapters:ParsedChapter[]=[];let total=0;
    for(let page=1;page<=doc.numPages;page++){
      const content=await(await doc.getPage(page)).getTextContent();
      const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();total+=text.length;assert(total<=MAX_TEXT,422,'正文超过 200 万字符，请拆分后导入');
      const blocks=text.split(/\n\s*\n/).flatMap(paragraph=>splitText(paragraph)).map((text,index)=>({text,locator:{page,paragraph:index+1}}));
      chapters.push({title:'第 '+page+' 页',inferred:true,origin:'page',depth:0,blocks});
    }
    // PDF 书签目标保留真实页码；同页书签无法可靠分段时回退逐页阅读。
    const boundaries:Boundary[]=[];let reliable=true;
    const walk=async(items:Awaited<ReturnType<typeof doc.getOutline>>,depth=0):Promise<void>=>{
      for(const item of items||[]){
        if(boundaries.length>=800||depth>32){reliable=false;return}
        let dest=item.dest;
        if(typeof dest==='string')dest=await doc.getDestination(dest);
        if(dest?.length){
          const page=typeof dest[0]==='number'?dest[0]:await doc.getPageIndex(dest[0]);
          const title=item.title?.trim().slice(0,180);
          if(title&&Number.isInteger(page)&&page>=0&&page<chapters.length){
            const start=chapters.slice(0,page).reduce((sum,c)=>sum+c.blocks.length,0);
            // 同页父子书签允许共用起点；平级书签共页则无法用页码精确区分。
            const previous=boundaries.at(-1);
            if(previous&&(start<previous.start||(start===previous.start&&depth<=previous.depth)))reliable=false;
            boundaries.push({title,start,depth});
          }
        }
        await walk(item.items,depth+1);
      }
    };
    try{await walk(await doc.getOutline())}catch{reliable=false}
    const structured=reliable&&boundaries.length?groupBlocks(chapters.flatMap(chapter=>chapter.blocks),boundaries,'outline'):chapters;
    return {chapters:checkText(structured),cover:includeCover?await pdfCover(doc):null};
  }finally{await loading.destroy()}
}
export function readZip(buffer:Buffer):Promise<Map<string,Buffer>>{
  return new Promise((resolve,reject)=>{
    yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,decodeStrings:true},(error,zip)=>{
      if(error||!zip)return reject(new AppError(422,'EPUB 归档已损坏'));
      const entries=new Map<string,Buffer>();let expanded=0,count=0,stopped=false;
      const fail=(message:string)=>{if(stopped)return;stopped=true;zip.close();reject(new AppError(422,message))};
      zip.on('error',()=>fail('EPUB 归档读取失败'));
      zip.on('entry',entry=>{
        count++;const path=entry.fileName;
        if(count>5000||entry.uncompressedSize>MAX_EXPANDED||expanded+entry.uncompressedSize>MAX_EXPANDED)return fail('EPUB 展开大小或条目数量超过限制');
        if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..')||entries.has(path))return fail('EPUB 包含不安全或重复的路径');
        if(entry.generalPurposeBitFlag&1)return fail('暂不支持加密 EPUB');
        if(path.endsWith('/')){zip.readEntry();return}
        zip.openReadStream(entry,(error,stream)=>{
          if(error||!stream)return fail('EPUB 条目无法读取');const chunks:Buffer[]=[];
          stream.on('data',(chunk:Buffer)=>{expanded+=chunk.length;if(expanded>MAX_EXPANDED){stream.destroy();fail('EPUB 展开大小超过限制')}else chunks.push(chunk)});
          stream.on('error',()=>fail('EPUB 条目已损坏'));
          stream.on('end',()=>{if(stopped)return;entries.set(path,Buffer.concat(chunks));zip.readEntry()});
        });
      });
      zip.on('end',()=>{if(!stopped)resolve(entries)});zip.readEntry();
    });
  });
}
const array=<T>(value:T|T[]|undefined):T[]=>value===undefined?[]:Array.isArray(value)?value:[value];
async function parseEpubBook(buffer:Buffer,includeCover:boolean):Promise<ParsedBook>{
  const entries=await readZip(buffer);
  assert(entries.get('mimetype')?.toString().trim()==='application/epub+zip',422,'文件不是有效 EPUB');
  assert(!entries.has('META-INF/encryption.xml'),422,'此 EPUB 包含加密声明，首版暂不处理');
  const xml=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,processEntities:false});
  const container=entries.get('META-INF/container.xml');assert(container,422,'EPUB 缺少目录清单');
  const root=array(xml.parse(container.toString()).container?.rootfiles?.rootfile)[0] as Record<string,string>|undefined;
  const opf=root?.['@full-path'];assert(opf&&entries.has(opf),422,'EPUB 缺少内容清单');
  const pkg=xml.parse(entries.get(opf)!.toString()).package;assert(pkg,422,'EPUB 内容清单无效');
  const manifest=array(pkg.manifest?.item) as Record<string,string>[];
  const spine=array(pkg.spine?.itemref) as Record<string,string>[];assert(spine.length&&spine.length<=800,422,'EPUB 阅读顺序为空或超过 800 节');
  const chapters:ParsedChapter[]=[];
  const documents:{path:string;index:number;start:number;anchors:Map<string,number>}[]=[];let count=0;
  for(const ref of spine){
    const item=manifest.find(item=>item['@id']===ref['@idref']);assert(item,422,'EPUB 阅读顺序引用不存在');
    if(!['application/xhtml+xml','text/html'].includes(item['@media-type']))continue;
    const target=localTarget(opf,item['@href']);assert(target,422,'EPUB 正文路径无效');
    const path=target.path,bytes=entries.get(path);assert(bytes,422,'EPUB 正文条目缺失');
    const $=load(bytes.toString());$('script,style,iframe,object,embed,svg').remove();
    const heading=$('body h1,body h2,body h3').first().text().trim();
    const title=(heading||$('title').first().text().trim()).slice(0,180)||'第 '+(chapters.length+1)+' 节';
    // 保持原有正文片段与 locator 的生成规则，旧书更新目录不重建来源。
    const nodes=$('body p,body h1,body h2,body h3,body li,body blockquote').filter((_,node)=>$(node).find('p,li,blockquote').length===0).toArray().filter(node=>$(node).text().trim());
    const lengths=nodes.map(node=>splitText($(node).text()).length),offsets:number[]=[];let offset=0;
    for(const length of lengths){offsets.push(offset);offset+=length}
    const blocks=(nodes.length?nodes.flatMap(node=>splitText($(node).text())):splitText($('body').text())).map((text,index)=>({text,locator:{href:path,paragraph:index+1}}));
    const order=new Map($('body,body *').toArray().map((node,index)=>[node,index]));
    const anchors=new Map<string,number>(),nodeIndex=new Map(nodes.map((node,index)=>[node,index]));
    const blockOrder=nodes.map(node=>order.get(node)??0);
    for(const node of $('body [id],body a[name],body[id]').toArray()){
      let ancestor:typeof node|null=node;
      while(ancestor&&!nodeIndex.has(ancestor))ancestor=ancestor.parent as typeof node|null;
      let index=ancestor?nodeIndex.get(ancestor)!:-1;
      if(index<0){
        let low=0,high=nodes.length;const at=order.get(node)??0;
        while(low<high){const mid=(low+high)>>>1;if(blockOrder[mid]<at)low=mid+1;else high=mid}
        index=low;
      }
      const at=index>=nodes.length?blocks.length:offsets[index];
      for(const name of [$(node).attr('id'),$(node).attr('name')])if(name&&!anchors.has(name))anchors.set(name,at);
    }
    documents.push({path,index:documents.length,start:count,anchors});count+=blocks.length;
    chapters.push({title,inferred:true,origin:heading?'heading':'file',depth:0,blocks});
  }
  const tocCandidates:{title:string;href:string;base:string;depth:number}[][]=[];
  // EPUB 3 导航文档优先；只取 toc，排除地标与页码导航。
  for(const item of manifest.filter(item=>(item['@properties']||'').split(/\s+/).includes('nav'))){
    const target=localTarget(opf,item['@href']);if(!target||!entries.has(target.path))continue;
    const $=load(entries.get(target.path)!.toString()),nav=$('nav').filter((_,node)=>($(node).attr('epub:type')||$(node).attr('type')||'').split(/\s+/).includes('toc')).first();
    const links=nav.find('a[href]').toArray().slice(0,801);
    tocCandidates.push(links.map(node=>({title:$(node).text().trim().slice(0,180),href:$(node).attr('href')!,base:target.path,depth:Math.max(0,$(node).parents('ol,ul').length-1)})));
  }
  const ncx=manifest.find(item=>item['@id']===pkg.spine?.['@toc'])||manifest.find(item=>item['@media-type']==='application/x-dtbncx+xml');
  if(ncx){
    const target=localTarget(opf,ncx['@href']);
    if(target&&entries.has(target.path))try{
      const items:{title:string;href:string;base:string;depth:number}[]=[];let exceeded=false;
      const walk=(points:unknown,depth=0)=>{if(depth>32){exceeded=true;return}for(const point of array(points) as Record<string,any>[]){if(items.length>=800){exceeded=true;return}const label=point.navLabel?.text;items.push({title:String(typeof label==='object'?label?.['#text']||'':label||'').trim().slice(0,180),href:point.content?.['@src']||'',base:target.path,depth});walk(point.navPoint,depth+1)}};
      walk(xml.parse(entries.get(target.path)!.toString()).ncx?.navMap?.navPoint);if(!exceeded)tocCandidates.push(items);
    }catch{/* 损坏的目录不影响正文提取。 */}
  }
  let structured=chapters;
  for(const items of tocCandidates){
    if(!items.length||items.length>800)continue;
    const boundaries:Boundary[]=[];let valid=true,lastTarget:{index:number;offset:number}|undefined;
    for(const item of items){
      const target=localTarget(item.base,item.href),document=target&&documents.find(document=>document.path===target.path);
      const offset=target?.anchor?document?.anchors.get(target.anchor):0;
      if(!target||!document||offset===undefined||!item.title||item.depth>32){valid=false;break}
      if(lastTarget&&(document.index<lastTarget.index||(document.index===lastTarget.index&&offset<lastTarget.offset))){valid=false;break}
      lastTarget={index:document.index,offset};
      const start=document.start+offset,previous=boundaries.at(-1);
      if(previous&&(start<previous.start||item.depth>previous.depth+1)){valid=false;break}
      // 空白或纯图片章节也保留目录项，不能把后一章的正文错归到前一项。
      boundaries.push({title:item.title,start,depth:item.depth});
    }
    if(valid&&boundaries.length&&boundaries[0].depth===0){structured=groupBlocks(chapters.flatMap(chapter=>chapter.blocks),boundaries,'toc');break}
  }
  if(structured===chapters){
    const titles=new Map<string,number>();for(const chapter of chapters)titles.set(chapter.title,(titles.get(chapter.title)||0)+1);
    for(const [index,chapter] of chapters.entries())if(chapter.origin==='file'&&titles.get(chapter.title)!>1)chapter.title='正文第 '+(index+1)+' 节';
  }
  return {chapters:checkText(structured),cover:includeCover?await epubCover(entries,opf,pkg).catch(()=>null):null};
}
export async function parsePdf(buffer:Buffer){return (await parsePdfBook(buffer,false)).chapters}
export async function parseEpub(buffer:Buffer){return (await parseEpubBook(buffer,false)).chapters}
export async function parseBook(buffer:Buffer,format:string){return format==='PDF'?parsePdfBook(buffer,true):parseEpubBook(buffer,true)}
export async function parseDocument(buffer:Buffer,format:string){return format==='PDF'?parsePdf(buffer):parseEpub(buffer)}
export async function parseFile(path:string,format:string){return parseDocument(await readFile(path),format)}
