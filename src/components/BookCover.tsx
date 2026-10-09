'use client';
import { useState } from 'react';
import type { Book } from './types';

export default function BookCover({book,onRead}:{book:Book;onRead:()=>void}){
  const [failed,setFailed]=useState(false);
  const image=book.hasCover&&!failed;
  return <button className={'book-cover'+(image?' book-cover-image':'')} disabled={book.status!=='ready'} onClick={onRead} aria-label={'阅读《'+book.title+'》'}>
    {image?<img src={'/api/books/'+book.id+'/cover'} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<><span>{book.format} / 文字封面</span><strong>{book.title}</strong><i aria-hidden="true"/><span>READOR / 我的藏书</span></>}
  </button>;
}
