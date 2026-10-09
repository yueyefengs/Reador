import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEmptyCard } from 'ts-fsrs';
import { graphSchema,validateCitations,validateGraph,validateRubric,assessmentSchema,assess,compileGraph } from '../src/modules/ai/validation';
import { nextSchedule } from '../src/modules/learning/scheduler';
import { hashPassword,verifyPassword,encrypt,decrypt } from '../src/lib/security';
import { isPublicAddress,protocolRequest,responseText,validateBase } from '../src/modules/ai/provider';
import { parsePdf,parseEpub } from '../src/modules/books/parse';
import { makePdf,makeEpub } from './fixtures';
const id=randomUUID(),source={id,text:'主动回忆需要先独立作答，然后核对原文。'};
describe('来源与评分约束',()=>{
 it('拒绝跨范围来源及虚构摘录',()=>{expect(()=>validateCitations({citations:[{sourceId:randomUUID(),quote:'主动回忆'}]},[source])).toThrow();expect(()=>validateCitations({citations:[{sourceId:id,quote:'不存在的内容'}]},[source])).toThrow();expect(()=>validateCitations({citations:[{sourceId:id,quote:'先独立作答'}]},[source])).not.toThrow()});
 it('拒绝重复节点、关系端点及错误权重',()=>{const node={id:'a',label:'回忆',definition:'独立提取',citations:[{sourceId:id,quote:'主动回忆'}]};expect(()=>validateGraph({nodes:[node,node],edges:[],warnings:[]})).toThrow();expect(()=>validateGraph({nodes:[node],edges:[{source:'a',target:'b',label:'需要',type:'requires',citations:node.citations}],warnings:[]})).toThrow();expect(()=>validateRubric([{point:'一点',weight:99}])).toThrow()});
 it('核算分数并拒绝超额、重复评分，失败不建议 Hard',()=>{const data={points:[{index:0,earned:40,feedback:'遗漏部分要点'}],feedback:'请补充',recommendation:'Hard' as const,citations:[{sourceId:id,quote:'主动回忆'}]};expect(assess(assessmentSchema.parse(data),[{point:'核心',weight:100}]).recommendation).toBe('Again');expect(()=>assess({...data,points:[data.points[0],data.points[0]]},[{point:'一',weight:50},{point:'二',weight:50}])).toThrow();expect(()=>assess({...data,points:[{...data.points[0],earned:100}]},[{point:'一',weight:50}])).toThrow()});
 it('Mermaid 标签不能注入链接或 HTML',()=>{const graph=graphSchema.parse({nodes:[{id:'a',label:'<script>"恶意"',definition:'定义',citations:[{sourceId:id,quote:'主动回忆'}]}],edges:[],warnings:[]});expect(compileGraph(graph)).not.toContain('<script>')});
});
describe('认证、凭据及协议',()=>{
 it('密码校验和加密密钥往返',async()=>{process.env.ENCRYPTION_KEY='a'.repeat(64);const hashed=await hashPassword('a-long-password');expect(await verifyPassword('a-long-password',hashed)).toBe(true);expect(await verifyPassword('wrong-password',hashed)).toBe(false);const cipher=encrypt('DEMO_SECRET');expect(cipher).not.toContain('DEMO_SECRET');expect(decrypt(cipher)).toBe('DEMO_SECRET')});
 it('三种协议有独立请求及解析结构',()=>{process.env.ENCRYPTION_KEY='b'.repeat(64);const base={baseUrl:'https://example.com/v1',model:'test',keyCipher:encrypt('demo'),timeout:60,retries:0,maxTokens:1000,temperature:null};expect(protocolRequest({...base,protocol:'chat'},'系统',{}).path).toBe('/chat/completions');expect(protocolRequest({...base,protocol:'responses'},'系统',{}).body).toHaveProperty('max_output_tokens');expect(protocolRequest({...base,protocol:'messages'},'系统',{}).headers).toHaveProperty('x-api-key');expect(responseText('responses',{output:[{content:[{type:'output_text',text:'返回内容'}]}]})).toBe('返回内容')});
 it('屏蔽私有网络及带凭据 URL',()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.2','::1','::ffff:127.0.0.1','2001:db8::1'])expect(isPublicAddress(ip)).toBeFalsy();expect(isPublicAddress('8.8.8.8')).toBeTruthy();expect(()=>validateBase('https://user:pass@example.com')).toThrow();expect(()=>validateBase('https://example.com/v1/responses')).toThrow()});
});
describe('解析与真实 FSRS',()=>{
 it('解析两页 PDF 并保留页码',async()=>{const chapters=await parsePdf(makePdf());expect(chapters).toHaveLength(2);expect(chapters[1].blocks[0].locator.page).toBe(2)});
 it('解析 EPUB 阅读顺序和段落',async()=>{const chapters=await parseEpub(await makeEpub());expect(chapters).toHaveLength(2);expect(chapters[0].blocks[0].text).toContain('主动回忆');expect(chapters[1].blocks[0].locator.href).toBe('OEBPS/two.xhtml')});
 it('拒绝空文件及路径穿越',async()=>{await expect(parsePdf(Buffer.from('invalid'))).rejects.toThrow();await expect(parseEpub(await makeEpub(true))).rejects.toThrow()});
 it('传入明确时间，保存和恢复后调度结果相同',()=>{const now=new Date('2026-10-08T00:00:00Z'),empty=createEmptyCard(now);const first=nextSchedule(empty,'Good',now);expect(first.reps).toBe(1);expect(first.due.getTime()).toBeGreaterThan(now.getTime());const next=new Date(first.due);expect(nextSchedule(JSON.parse(JSON.stringify(first)),'Good',next)).toEqual(nextSchedule(first,'Good',next));expect(nextSchedule(first,'Again',next).lapses).toBeGreaterThanOrEqual(first.lapses)});
});
