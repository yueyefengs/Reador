import { describe,it,expect,vi,beforeEach } from 'vitest';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { generateGraph } from '../src/modules/ai/graph';
import { CitationValidationError } from '../src/modules/ai/validation';
import { encrypt } from '../src/lib/security';
const {modelRequest}=vi.hoisted(()=>({modelRequest:vi.fn()}));
vi.mock('undici',()=>({request:modelRequest,Agent:class {async close(){}}}));
vi.mock('../src/lib/network',()=>({resolveModelHost:async()=>[{address:'8.8.8.8',family:4}],isPublicAddress:()=>true}));
import { agentInput,callModel,protocolRequest } from '../src/modules/ai/provider';
import { providerDefaults,DEFAULT_MAX_OUTPUT_TOKENS } from '../src/modules/ai/presets';
const schema=z.object({message:z.string()}).strict();
const config=()=>({protocol:'chat',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',keyCipher:encrypt('DEMO_NOT_REAL'),timeout:10,retries:1,maxTokens:4096,temperature:null});
const envelope=(content:unknown,finish_reason='stop',reasoning_content='')=>({choices:[{finish_reason,message:{content,reasoning_content}}]});
function response(value:unknown){return {statusCode:200,body:(async function*(){yield Buffer.from(typeof value==='string'?value:JSON.stringify(value))})()}}
beforeEach(()=>{process.env.ENCRYPTION_KEY='e'.repeat(64);modelRequest.mockReset()});
describe('模型输出预算与诊断',()=>{
 it('新建配置默认 1M，前后端允许相同范围，保留显式的小预算',()=>{
  const input={name:'测试配置',...providerDefaults('deepseek'),apiKey:'DEMO_NOT_REAL'};expect(input.maxTokens).toBe(1_000_000);
  const {maxTokens,...omitted}=input;expect(agentInput.parse(omitted).maxTokens).toBe(maxTokens);
  expect(agentInput.parse({...input,maxTokens:4096}).maxTokens).toBe(4096);
  expect(agentInput.safeParse({...input,maxTokens:DEFAULT_MAX_OUTPUT_TOKENS+1}).success).toBe(false);
  expect(agentInput.safeParse({...input,maxTokens:255}).success).toBe(false);
 });
 it('三种协议使用已知官方输出上限，未知型号与网关保留填写值',()=>{
  for(const [protocol,baseUrl,model,expected] of [['chat','https://api.deepseek.com','deepseek-flash',393216],['responses','https://api.openai.com/v1','gpt-6.1-sol',128000],['messages','https://api.anthropic.com/v1','claude-opus-5-5',131072],['chat','https://open.bigmodel.cn/api/paas/v4','glm-5.3',131072],['chat','https://gateway.example/v1','deepseek-flash',1000000],['chat','https://api.deepseek.com.evil.example','deepseek-flash',1000000],['chat','https://api.deepseek.com','unknown-model',1000000]] as const){
   const payload=protocolRequest({...config(),protocol,baseUrl,model,maxTokens:DEFAULT_MAX_OUTPUT_TOKENS},'测试',{});
   expect(payload.body).toHaveProperty(protocol==='responses'?'max_output_tokens':'max_tokens',expected);
  }
 });
 it('截断错误显示实际生效值，避免误报配置的 1M',async()=>{
  modelRequest.mockResolvedValueOnce(response(envelope(null,'length')));
  await expect(callModel({...config(),maxTokens:DEFAULT_MAX_OUTPUT_TOKENS},'测试',schema,{},[])).rejects.toThrow(/393216 token/);
 });
 it('长输出不再受固定 2 MB 限制，仍校验最终结构',async()=>{
  const message='a'.repeat(2_100_000);modelRequest.mockResolvedValueOnce(response(envelope(JSON.stringify({message}))));
  expect((await callModel({...config(),maxTokens:DEFAULT_MAX_OUTPUT_TOKENS},'测试',schema,{},[])).message.length).toBe(message.length);
 });
 it('响应体超过预算对应的字节边界时停止读取且不重试',async()=>{
  const body=Object.assign((async function*(){yield Buffer.alloc(2_000_001)})(),{destroy:vi.fn()});
  modelRequest.mockResolvedValueOnce({statusCode:200,body});
  await expect(callModel(config(),'测试',schema,{},[])).rejects.toThrow(/响应超过处理限额/);
  expect(body.destroy).toHaveBeenCalledOnce();expect(modelRequest).toHaveBeenCalledOnce();
 });
 it('DeepSeek 官方结构化 Chat 调用关闭默认思考，保留用户 token 上限',()=>{
  const payload=protocolRequest(config(),'输出 JSON',{});expect(payload.body).toHaveProperty('thinking',{type:'disabled'});expect(payload.body).toHaveProperty('max_tokens',4096);
  expect(protocolRequest({...config(),model:'deepseek-flash'},'输出 JSON',{}).body).toHaveProperty('thinking',{type:'disabled'});
  expect(protocolRequest({...config(),baseUrl:'https://gateway.example/v1'},'输出 JSON',{}).body).not.toHaveProperty('thinking');
  expect(protocolRequest({...config(),baseUrl:'https://api.deepseek.com.evil.example'},'输出 JSON',{}).body).not.toHaveProperty('thinking');
 });
 it('识别思考耗尽预算，即使 HTTP 200 也报告截断且不重复调用',async()=>{
  modelRequest.mockResolvedValueOnce(response(envelope(null,'length','不得作为最终答案使用的推理文本')));
  await expect(callModel(config(),'测试',schema,{},[])).rejects.toThrow(/输出上限.*4096.*截断/);expect(modelRequest).toHaveBeenCalledTimes(1);
 });
 it('结束原因是 length 时不接受碰巧完整的 JSON',async()=>{
  modelRequest.mockResolvedValueOnce(response(envelope('{"message":"仍是不完整的任务结果"}','length')));
  await expect(callModel(config(),'测试',schema,{},[])).rejects.toThrow(/截断/);
 });
 it('兼容 Messages 和 Responses 的输出上限状态',async()=>{
  for(const [protocol,value] of [['messages',{stop_reason:'max_tokens',content:[{type:'text',text:'{"message":"半份结果"}'}]}],['responses',{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{content:[{type:'output_text',text:'{"message":"半份结果"}'}]}]}]] as const){
   modelRequest.mockResolvedValueOnce(response(value));await expect(callModel({...config(),protocol},'测试',schema,{},[])).rejects.toThrow(/截断/);
  }
 });
 it('区分仅有推理、空回答、错误 JSON 和结构不匹配',async()=>{
  for(const [value,message] of [[envelope('','stop','推理内容'),/只返回了思考内容/],[envelope(''),/未返回最终回答/],[envelope('{"message":'),/JSON 不完整或格式错误/],[envelope('{"wrong":"字段"}'),/结构不符合要求/]] as const){
   modelRequest.mockResolvedValueOnce(response(value));await expect(callModel(config(),'测试',schema,{},[])).rejects.toThrow(message);
  }
 });
 it('有效最终 JSON 仍通过结构与引用校验，忽略推理字段',async()=>{
  modelRequest.mockResolvedValueOnce(response(envelope('```json\n{"message":"通过"}\n```','stop','私有推理')));
  expect(await callModel(config(),'测试',schema,{},[])).toEqual({message:'通过'});
 });
});


describe('图谱引用有限重生成',()=>{
 const source={id:randomUUID(),text:'观察和评价应当分开。先陈述观察，再表达感受。'};
 const graph=(sourceId=source.id,quote='观察和评价应当分开')=>({nodes:[{id:'observation',label:'观察',definition:'先陈述观察',citations:[{sourceId,quote}]}],edges:[],warnings:[]});
 it('引用失配时仅重生成一次，仍严格验证并保留原范围',async()=>{
  modelRequest.mockResolvedValueOnce(response(envelope(JSON.stringify(graph(source.id,'被改写的摘录'))))).mockResolvedValueOnce(response(envelope(JSON.stringify(graph()))));
  expect((await generateGraph(config(),[source])).nodes).toHaveLength(1);expect(modelRequest).toHaveBeenCalledTimes(2);
  const first=JSON.parse(modelRequest.mock.calls[0][1].body),second=JSON.parse(modelRequest.mock.calls[1][1].body);
  const input=JSON.parse(second.messages[1].content);expect(input.sources).toEqual(JSON.parse(first.messages[1].content).sources);expect(input.citationErrors).toEqual([{path:'nodes[0].citations[0]',reason:'quote_mismatch'}]);
 });
 it('第二次仍使用范围外来源时拒绝，不产生第三次调用',async()=>{
  modelRequest.mockImplementation(async()=>response(envelope(JSON.stringify(graph(randomUUID())))));
  await expect(generateGraph(config(),[source])).rejects.toBeInstanceOf(CitationValidationError);expect(modelRequest).toHaveBeenCalledTimes(2);
 });
 it('标点或空格被改写时仍不接受，错误不泄露摘录正文',async()=>{
  modelRequest.mockImplementation(async()=>response(envelope(JSON.stringify(graph(source.id,'观察 和评价应当分开')))));
  await expect(generateGraph(config(),[source])).rejects.toThrow(/摘录与原文不逐字匹配/);expect(modelRequest).toHaveBeenCalledTimes(2);
  expect(new CitationValidationError([{path:'nodes[0].citations[0]',reason:'quote_mismatch'}]).message).not.toContain(source.text);
 });
 it('已取消的调用不自动重生成',async()=>{
  const controller=new AbortController();modelRequest.mockImplementationOnce(async()=>{controller.abort();return response(envelope(JSON.stringify(graph(randomUUID()))))});
  await expect(generateGraph(config(),[source],controller.signal)).rejects.toBeInstanceOf(CitationValidationError);expect(modelRequest).toHaveBeenCalledOnce();
 });
 it('有效引用正常返回一次，截断不会触发引用重生成',async()=>{
  modelRequest.mockResolvedValueOnce(response(envelope(JSON.stringify(graph()))));expect((await generateGraph(config(),[source])).nodes.length).toBe(1);expect(modelRequest).toHaveBeenCalledOnce();
  modelRequest.mockReset();modelRequest.mockResolvedValueOnce(response(envelope(null,'length')));await expect(generateGraph(config(),[source])).rejects.toThrow(/截断/);expect(modelRequest).toHaveBeenCalledOnce();
 });
});
