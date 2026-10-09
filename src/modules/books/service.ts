import { createHash, randomUUID } from 'node:crypto';
import { and,eq,asc,inArray } from 'drizzle-orm';
import { db } from '../../lib/db';
import { books, chapters, sources, jobs } from '../../lib/schema';
import { assert } from '../../lib/errors';
import { chapterScope,STRUCTURE_VERSION } from './structure';
import { writeStoredFile,deleteStoredFile } from '../../lib/storage';
export async function ownedBook(ownerId:string,bookId:string){const [book]=await db.select().from(books).where(and(eq(books.id,bookId),eq(books.ownerId,ownerId)));assert(book,404,'书籍不存在');return book}
export async function upload(ownerId:string,file:File){
  assert(file.size>0&&file.size<=50*1024*1024,422,'请选择不超过 50 MB 的非空文件');
  const format=file.name.toLowerCase().endsWith('.pdf')?'PDF':file.name.toLowerCase().endsWith('.epub')?'EPUB':null;assert(format,422,'仅支持 PDF 和 EPUB');
  const buffer=Buffer.from(await file.arrayBuffer());assert(format==='PDF'?buffer.subarray(0,5).toString()==='%PDF-':buffer.subarray(0,2).toString()==='PK',422,'文件内容与扩展名不匹配');
  const hash=createHash('sha256').update(buffer).digest('hex');
  const [existing]=await db.select().from(books).where(and(eq(books.ownerId,ownerId),eq(books.hash,hash)));
  if(existing){
    // 旧书再次上传只补封面，不替换来源、题目或复习状态。
    if(existing.status==='ready'&&!existing.coverCipher)await db.insert(jobs).values({ownerId,bookId:existing.id,kind:'cover',chapterIds:[],sourceBatches:[],idempotencyKey:'cover:'+existing.id}).onConflictDoUpdate({target:[jobs.ownerId,jobs.idempotencyKey],set:{status:'queued',errors:[],token:null,lease:null},setWhere:inArray(jobs.status,['failed','cancelled'])});
    return existing;
  }
  const id=randomUUID(),reference=await writeStoredFile(ownerId,id,format,buffer);
  try{
    return await db.transaction(async tx=>{
      const [book]=await tx.insert(books).values({id,ownerId,title:file.name.replace(/\.(pdf|epub)$/i,'').slice(0,180),filename:file.name.slice(0,255),format,hash,storagePath:reference}).onConflictDoNothing().returning();
      if(!book){const [same]=await tx.select().from(books).where(and(eq(books.ownerId,ownerId),eq(books.hash,hash)));await deleteStoredFile(reference);return same}
      await tx.insert(jobs).values({ownerId,bookId:id,kind:'parse',chapterIds:[],sourceBatches:[],idempotencyKey:'parse:'+id});return book;
    });
  }catch(error){await deleteStoredFile(reference).catch(()=>{});throw error}
}
export async function queueStructure(ownerId:string,bookId:string){
  const book=await ownedBook(ownerId,bookId);assert(book.status==='ready',422,'书籍尚未完成解析');
  if(book.structureVersion>=STRUCTURE_VERSION)return null;
  const [job]=await db.insert(jobs).values({ownerId,bookId,kind:'structure',chapterIds:[],sourceBatches:[],idempotencyKey:'structure:'+STRUCTURE_VERSION+':'+bookId}).onConflictDoUpdate({target:[jobs.ownerId,jobs.idempotencyKey],set:{status:'queued',errors:[],token:null,lease:null},setWhere:inArray(jobs.status,['failed','cancelled'])}).returning();
  return job||(await db.select().from(jobs).where(and(eq(jobs.ownerId,ownerId),eq(jobs.idempotencyKey,'structure:'+STRUCTURE_VERSION+':'+bookId))))[0];
}
export async function getSources(ownerId:string,bookId:string,chapterIds?:string[]){
  await ownedBook(ownerId,bookId);
  const catalog=await db.select().from(chapters).where(and(eq(chapters.ownerId,ownerId),eq(chapters.bookId,bookId))).orderBy(asc(chapters.position));
  const active=catalog.filter(chapter=>chapter.active),scope=chapterScope(active,chapterIds||[]);
  // 历史会话仍使用更新前的范围，不能因目录合并静默扩大引用范围。
  const archived=new Set(catalog.filter(chapter=>!chapter.active&&chapterIds?.includes(chapter.id)).flatMap(chapter=>chapter.archivedSourceIds||[]));
  const rows=await db.select().from(sources).innerJoin(chapters,eq(sources.chapterId,chapters.id)).where(and(eq(sources.ownerId,ownerId),eq(sources.bookId,bookId))).orderBy(asc(chapters.position),asc(sources.position));
  return rows.map(row=>row.sources).filter(source=>!chapterIds?.length||scope.has(source.chapterId)||archived.has(source.id));
}
