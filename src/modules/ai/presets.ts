// 新建配置使用核对日的官方通用模型；已有配置与环境变量保持用户选择。
export const MODEL_PRESETS_CHECKED_AT='2026-10-08';
export const DEFAULT_MAX_OUTPUT_TOKENS=1_000_000;
export const presets={
  openai:{name:'OpenAI',baseUrl:'https://api.openai.com/v1',protocol:'responses',model:'gpt-6.1-sol',docsUrl:'https://developers.openai.com/api/docs/models/gpt-6.1-sol'},
  claude:{name:'Anthropic / Claude',baseUrl:'https://api.anthropic.com/v1',protocol:'messages',model:'claude-opus-5-5',docsUrl:'https://platform.claude.com/docs/en/models/overview'},
  glm:{name:'智谱 / GLM',baseUrl:'https://open.bigmodel.cn/api/paas/v4',protocol:'chat',model:'glm-5.3',docsUrl:'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3'},
  deepseek:{name:'DeepSeek',baseUrl:'https://api.deepseek.com',protocol:'chat',model:'deepseek-flash',docsUrl:'https://api-docs.deepseek.com/'},
  custom:{name:'其他 / 自定义',baseUrl:'',protocol:'chat',model:'',docsUrl:''},
} as const;

// 仅对已核实的官方主机与型号应用输出限制；网关的能力由用户填写。
export function modelOutputLimit(baseUrl:string,model:string):number|undefined{
  let host:string;try{host=new URL(baseUrl).hostname}catch{return undefined}
  if(host==='api.deepseek.com'&&['deepseek-flash','deepseek-pro','deepseek-v4-flash','deepseek-v4-pro'].includes(model))return 393_216;
  if(host==='api.openai.com'&&model==='gpt-6.1-sol')return 128_000;
  if(host==='api.anthropic.com'&&model==='claude-opus-5-5')return 131_072;
  if(['open.bigmodel.cn','api.z.ai'].includes(host)&&model==='glm-5.3')return 131_072;
}
export function effectiveMaxOutputTokens(config:{baseUrl:string;model:string;maxTokens:number}){return Math.min(config.maxTokens,modelOutputLimit(config.baseUrl,config.model)??config.maxTokens)}
export function providerDefaults(provider:keyof typeof presets):{provider:string;protocol:string;baseUrl:string;route:string;model:string;apiKey:string;maxTokens:number}{const preset=presets[provider];return {provider,protocol:preset.protocol,baseUrl:preset.baseUrl,route:provider==='custom'?'third-party':'official',model:preset.model,apiKey:'',maxTokens:DEFAULT_MAX_OUTPUT_TOKENS}}
