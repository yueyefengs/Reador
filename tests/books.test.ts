import { describe,it,expect } from 'vitest';
import sharp from 'sharp';
import { normalizeCover } from '../src/modules/books/cover';
import { parseEpub,parsePdf,parseBook } from '../src/modules/books/parse';
import { zipSync,unzipSync,strToU8 } from 'fflate';
import { chapterScope,localTarget } from '../src/modules/books/structure';
import { batchSources,SOURCE_BATCH_CHARACTERS } from '../src/modules/books/batches';
import { makeEpub,makePdf,makeStructuredEpub } from './fixtures';

describe('书内封面提取',()=>{
  it.each(['epub2','epub3','guide','spine','encoded'] as const)('读取 %s 封面，保留正文与位置',async kind=>{
    const parsed=await parseBook(await makeEpub(false,{cover:kind}),'EPUB');
    expect(parsed.cover).not.toBeNull();
    const metadata=await sharp(parsed.cover!).metadata();
    expect(metadata.format).toBe('jpeg');expect(metadata.width).toBeLessThanOrEqual(480);expect(metadata.height).toBeLessThanOrEqual(720);
    expect(parsed.chapters.at(-1)?.blocks[0].locator.href).toBe('OEBPS/two.xhtml');
    expect(parsed.chapters.at(-1)?.blocks[0].text).toContain('反馈');
  });
  it.each([undefined,'corrupt','external','traversal','svg'] as const)('无可用封面（%s）时仍可阅读',async kind=>{
    const parsed=await parseBook(await makeEpub(false,{cover:kind}),'EPUB');
    expect(parsed.cover).toBeNull();expect(parsed.chapters).toHaveLength(2);
  });
  it('PDF 首页渲染为有内容的缩略图，并保留后续页码',async()=>{
    const parsed=await parseBook(makePdf(),'PDF');expect(parsed.cover).not.toBeNull();
    const metadata=await sharp(parsed.cover!).metadata();expect(metadata.format).toBe('jpeg');expect(metadata.width).toBeLessThanOrEqual(480);
    const statistics=await sharp(parsed.cover!).stats();expect(statistics.channels.some(channel=>channel.min<200)).toBe(true);
    expect(parsed.chapters[1].blocks[0].locator.page).toBe(2);
  });
  it('PDF 空白首页使用文字封面，后续正文仍可阅读',async()=>{
    const parsed=await parseBook(makePdf(true),'PDF');expect(parsed.cover).toBeNull();expect(parsed.chapters[0].blocks).toHaveLength(0);expect(parsed.chapters[1].blocks[0].locator.page).toBe(2);
  });
  it('拒绝过大、损坏和可执行的图片字节',async()=>{
    for(const bytes of [Buffer.alloc(8*1024*1024+1),Buffer.from('<svg><script/></svg>'),Buffer.from([255,216,0])])expect(await normalizeCover(bytes)).toBeNull();
  });
});

describe('长书原文分批',()=>{
  it('跨章节保留全部片段与顺序，每批不超过正文限额',()=>{
    const sources=Array.from({length:90},(_,index)=>({id:String(index),text:'原文'.repeat(700)}));
    const batches=batchSources(sources);
    expect(batches.length).toBeGreaterThan(1);expect(batches.flat()).toEqual(sources.map(source=>source.id));
    for(const batch of batches)expect(batch.reduce((sum,id)=>sum+sources[Number(id)].text.length,0)).toBeLessThanOrEqual(SOURCE_BATCH_CHARACTERS);
  });
  it('边界批次不丢失片段，不允许异常长片段绕过上限',()=>{
    expect(batchSources([{id:'a',text:'字'.repeat(10000)},{id:'b',text:'字'}])).toEqual([['a'],['b']]);
    expect(batchSources([])).toEqual([]);expect(()=>batchSources([{id:'a',text:'字'.repeat(10001)}])).toThrow();
  });
});


describe('按原书目录拆分',()=>{
  it.each(['ncx','nav'] as const)('%s 目录合并跨文件章节，保留全部正文位置',async toc=>{
    const parsed=await parseEpub(await makeStructuredEpub({toc}));
    expect(parsed.map(chapter=>chapter.title)).toEqual(['第一章 回忆与反馈','第二章 再次练习']);
    expect(parsed.every(chapter=>chapter.origin==='toc'&&!chapter.inferred)).toBe(true);
    expect(parsed[0].blocks.map(block=>block.locator.href)).toEqual(['OEBPS/one.xhtml','OEBPS/one.xhtml','OEBPS/two.xhtml']);
    expect(parsed.flatMap(chapter=>chapter.blocks)).toHaveLength(5);
  });
  it.each(['ncx','nav'] as const)('%s 支持同文件锚点、容器锚点及跨文件延续',async toc=>{
    const parsed=await parseEpub(await makeStructuredEpub({toc,layout:'anchors',prefix:true}));
    expect(parsed.map(chapter=>chapter.blocks.length)).toEqual([1,1,3,1]);
    expect(parsed[0].title).toBe('目录前正文');
    expect(parsed[2].blocks.at(-1)?.locator).toEqual({href:'OEBPS/three.xhtml',paragraph:1});
    expect(parsed[3].blocks[0].locator).toEqual({href:'OEBPS/three.xhtml',paragraph:2});
  });
  it.each(['ncx','nav'] as const)('%s 保留父子层级，父章节范围包含子章节',async toc=>{
    const parsed=await parseEpub(await makeStructuredEpub({toc,layout:'nested'}));
    expect(parsed.map(chapter=>chapter.depth)).toEqual([0,1,1,0]);
    expect(parsed.map(chapter=>chapter.blocks.length)).toEqual([0,2,1,2]);
    const catalog=parsed.map((chapter,index)=>({...chapter,id:String(index)}));
    expect([...chapterScope(catalog,['0','1'])]).toEqual(['0','1','2']);
    expect([...chapterScope(catalog,['1'])]).toEqual(['1']);
  });
  it.each(['broken','external','backwards','missing-anchor'] as const)('目录 %s 时完整回退并明确标注推断',async toc=>{
    const parsed=await parseEpub(await makeStructuredEpub({toc}));
    expect(parsed.map(chapter=>chapter.title)).toEqual(['正文第 1 节','正文第 2 节','正文第 3 节']);
    expect(parsed.every(chapter=>chapter.origin==='file'&&chapter.inferred)).toBe(true);
    expect(parsed.flatMap(chapter=>chapter.blocks)).toHaveLength(5);
  });
  it('PDF 有书签时按书签合并页面，定位仍为真实页码',async()=>{
    const parsed=await parsePdf(makePdf(false,true));
    expect(parsed).toHaveLength(1);expect(parsed[0].origin).toBe('outline');
    expect(parsed[0].blocks.map(block=>block.locator.page)).toEqual([1,2]);
    expect((await parsePdf(makePdf()))[0].origin).toBe('page');
  });
  it('纯图片或空白目录项保留为空，不抢占下一章正文',async()=>{
    const files=unzipSync(await makeStructuredEpub({layout:'anchors'}));
    files['OEBPS/one.xhtml']=strToU8('<html><body><div id="start"><img src="cover.png"/></div><p id="second">真实的正文只属于第二个目录项，不能错归到图片页。</p></body></html>');
    const parsed=await parseEpub(Buffer.from(zipSync(files)));
    expect(parsed.map(chapter=>chapter.title)).toEqual(['独立回忆','理解缺口','再次练习']);
    expect(parsed[0].blocks).toHaveLength(0);expect(parsed[1].blocks[0].text).toContain('只属于第二个目录项');
  });
  it('没有目录时优先正文标题，不用 head 中的书名覆盖章节名',async()=>{
    const files=unzipSync(await makeEpub());
    files['OEBPS/one.xhtml']=strToU8('<html><head><title>全书书名</title></head><body><h1>真正的章节标题</h1><p>这里是原创的章节正文，保留读取顺序与位置。</p></body></html>');
    const parsed=await parseEpub(Buffer.from(zipSync(files)));expect(parsed[0].title).toBe('真正的章节标题');expect(parsed[0].origin).toBe('heading');expect(parsed[0].inferred).toBe(true);
  });
  it('目录路径拒绝越界、外链、反斜线和编码错误',()=>{
    for(const href of ['../../escape','%2Fetc/passwd','https://example.com/book','//example.com/book','foo%5Cbar','%XX','%00'])expect(localTarget('OEBPS/toc.ncx',href)).toBeNull();
    expect(localTarget('OEBPS/nav/toc.xhtml','../one.xhtml#正文')).toEqual({path:'OEBPS/one.xhtml',anchor:'正文'});
  });
});
