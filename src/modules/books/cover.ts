import { posix } from 'node:path';
import { load } from 'cheerio';
import sharp from 'sharp';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

const array=<T>(value:T|T[]|undefined):T[]=>value===undefined?[]:Array.isArray(value)?value:[value];
const MAX_COVER_BYTES=8*1024*1024;

export async function normalizeCover(bytes:Buffer):Promise<Buffer|null>{
  if(!bytes.length||bytes.length>MAX_COVER_BYTES)return null;
  // 只接收本地栅格字节，禁止 SVG、HTML、远程图片及超大像素图。
  const raster=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216||bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'||/^GIF8[79]a$/.test(bytes.subarray(0,6).toString());
  if(!raster)return null;
  try{return await sharp(bytes,{limitInputPixels:20_000_000,animated:false}).rotate().resize({width:480,height:720,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:82}).toBuffer()}catch{return null}
}

function archivePath(base:string,href:string){
  try{
    if(!href||/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('/')||href.includes('\\'))return null;
    const decoded=decodeURIComponent(href.split('#')[0]);
    if(decoded.startsWith('/')||decoded.includes('\\')||/^[a-z][a-z0-9+.-]*:/i.test(decoded))return null;
    const path=posix.normalize(posix.join(posix.dirname(base),decoded));
    return path.startsWith('../')?null:path;
  }catch{return null}
}

type EpubPackage={manifest?:{item?:Record<string,string>|Record<string,string>[]};metadata?:{meta?:Record<string,string>|Record<string,string>[]};guide?:{reference?:Record<string,string>|Record<string,string>[]};spine?:{itemref?:Record<string,string>|Record<string,string>[]}};
export async function epubCover(entries:Map<string,Buffer>,opf:string,pkg:EpubPackage):Promise<Buffer|null>{
  const manifest=array(pkg.manifest?.item),metadata=array(pkg.metadata?.meta);
  const coverId=metadata.find(item=>item['@name']==='cover')?.['@content'];
  const declared=manifest.filter(item=>item['@properties']?.split(/\s+/).includes('cover-image')||coverId&&item['@id']===coverId);
  const guide=array(pkg.guide?.reference).filter(item=>item['@type']?.split(/\s+/).includes('cover'));
  const first=manifest.find(item=>item['@id']===array(pkg.spine?.itemref)[0]?.['@idref']);
  const candidates=[...declared,...guide,...(first?[first]:[])];
  for(const item of candidates){
    const path=archivePath(opf,item['@href']);if(!path)continue;
    const bytes=entries.get(path);if(!bytes)continue;
    const image=await normalizeCover(bytes);if(image)return image;
    if(bytes.length>1024*1024)continue;
    const $=load(bytes.toString());
    // 仅从封面声明或首节封面页查找图片，不把普通章节插图当作封面。
    if(item===first&&!declared.includes(item)&&!guide.includes(item)&&!/(^|[\s/_-])cover([\s/_.-]|$)/i.test([item['@id'],item['@href'],$('[epub\\:type]').attr('epub:type')].join(' ')))continue;
    for(const node of $('img,svg image').toArray()){
      const href=$(node).attr('src')||$(node).attr('href')||$(node).attr('xlink:href')||'';
      const imagePath=archivePath(path,href),data=imagePath?entries.get(imagePath):undefined;
      if(data){const image=await normalizeCover(data);if(image)return image}
    }
  }
  return null;
}

export async function pdfCover(doc:PDFDocumentProxy):Promise<Buffer|null>{
  try{
    const {createCanvas}=await import('@napi-rs/canvas');
    const page=await doc.getPage(1),original=page.getViewport({scale:1});
    if(!Number.isFinite(original.width)||!Number.isFinite(original.height)||original.width<=0||original.height<=0)return null;
    const viewport=page.getViewport({scale:Math.min(480/original.width,720/original.height)});
    const canvas=createCanvas(Math.max(1,Math.ceil(viewport.width)),Math.max(1,Math.ceil(viewport.height)));
    await page.render({canvas:canvas as unknown as HTMLCanvasElement,viewport,background:'#ffffff'}).promise;
    const bytes=canvas.toBuffer('image/png');
    const statistics=await sharp(bytes).stats();
    if(statistics.channels.every(channel=>channel.min>=250))return null;
    return await normalizeCover(bytes);
  }catch{return null}
}
