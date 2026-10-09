import { and,eq,asc,sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { books,chapters,sources,progress,jobs } from '../../lib/schema';
import { assert } from '../../lib/errors';
import { readStoredFile } from '../../lib/storage';
import { parseDocument } from './parse';
import { chapterScope,STRUCTURE_VERSION } from './structure';
import { ownedBook } from './service';

export async function upgradeStructure(job:typeof jobs.$inferSelect){
  const book=await ownedBook(job.ownerId,job.bookId);
  if(book.structureVersion>=STRUCTURE_VERSION)return;
  assert(book.status==='ready',422,'仅可更新已完成解析的书籍目录');
  const parsed=await parseDocument(await readStoredFile(book.storagePath),book.format);
  await db.transaction(async tx=>{
    await tx.execute(sql`select id from jobs where id=${job.id} for update`);
    const [live]=await tx.select().from(jobs).where(eq(jobs.id,job.id));
    if(live.status!=='running'||live.token!==job.token)return;
    await tx.execute(sql`select id from books where id=${book.id} and owner_id=${job.ownerId} for update`);
    const [current]=await tx.select().from(books).where(eq(books.id,book.id));
    if(current.structureVersion>=STRUCTURE_VERSION)return;
    const oldChapters=await tx.select().from(chapters).where(and(eq(chapters.bookId,book.id),eq(chapters.ownerId,job.ownerId),eq(chapters.active,true))).orderBy(asc(chapters.position));
    const oldSources=await tx.select().from(sources).where(and(eq(sources.bookId,book.id),eq(sources.ownerId,job.ownerId)));
    const key=(source:{text:string;locator:{page?:number;href?:string;paragraph:number}})=>JSON.stringify([source.locator.page??null,source.locator.href??null,source.locator.paragraph,source.text]);
    const remaining=new Map<string,(typeof sources.$inferSelect)[]>();
    for(const source of oldSources){const k=key(source);remaining.set(k,[...(remaining.get(k)||[]),source])}
    const matched=parsed.map(chapter=>chapter.blocks.map(block=>{
      const source=remaining.get(key(block))?.shift();assert(source,409,'原文片段与旧版不一致，已保留旧目录；需要人工核对后迁移');return source;
    }));
    assert(matched.flat().length===oldSources.length&&[...remaining.values()].every(items=>items.length===0),409,'目录更新无法完整匹配原文，已保留旧目录');
    // 保留旧章节及其来源范围，历史会话、任务不被级联删除或扩大范围。
    const allPositions=await tx.select({position:chapters.position}).from(chapters).where(eq(chapters.bookId,book.id));
    let archivedPosition=Math.min(-1,...allPositions.map(chapter=>chapter.position))-1;
    for(const old of oldChapters){
      const scope=chapterScope(oldChapters,[old.id]);
      await tx.update(chapters).set({active:false,position:archivedPosition--,archivedSourceIds:oldSources.filter(source=>scope.has(source.chapterId)).map(source=>source.id)}).where(eq(chapters.id,old.id));
    }
    const assignments:{id:string;chapterId:string;position:number}[]=[];
    for(const [position,chapter] of parsed.entries()){
      const [entry]=await tx.insert(chapters).values({ownerId:job.ownerId,bookId:book.id,position,title:chapter.title,inferred:chapter.inferred,depth:chapter.depth,origin:chapter.origin}).returning();
      for(const [index,source] of matched[position].entries())assignments.push({id:source.id,chapterId:entry.id,position:index});
    }
    for(let offset=0;offset<assignments.length;offset+=500){
      const values=sql.join(assignments.slice(offset,offset+500).map(row=>sql`(${row.id}::uuid,${row.chapterId}::uuid,${row.position}::integer)`),sql`, `);
      await tx.execute(sql`update sources s set chapter_id=v.chapter_id,position=v.position from (values ${values}) as v(id,chapter_id,position) where s.id=v.id and s.owner_id=${job.ownerId} and s.book_id=${book.id}`);
    }
    const [saved]=await tx.select().from(progress).where(and(eq(progress.bookId,book.id),eq(progress.ownerId,job.ownerId)));
    if(saved){
      const anchor=saved.sourceId||oldSources.filter(source=>source.chapterId===saved.chapterId).sort((a,b)=>a.position-b.position)[0]?.id;
      const target=assignments.find(row=>row.id===anchor)||assignments[0];
      if(target)await tx.update(progress).set({chapterId:target.chapterId}).where(eq(progress.id,saved.id));
    }
    await tx.update(books).set({structureVersion:STRUCTURE_VERSION}).where(eq(books.id,book.id));
  });
}
