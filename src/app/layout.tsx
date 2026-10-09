import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Reador · 阅读与学习',description:'围绕原文理解、回忆和复习'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
