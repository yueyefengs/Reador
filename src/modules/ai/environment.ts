import { encrypt } from '../../lib/security';
import { assert } from '../../lib/errors';
import { presets,validateBase } from './provider';
import { DEFAULT_MAX_OUTPUT_TOKENS } from './presets';
type Provider='deepseek'|'glm';
export function environmentAccess(email:string){const mode=process.env.ENV_MODEL_ACCESS||'disabled';return mode==='shared'||mode==='owner'&&email.toLowerCase()===(process.env.ENV_MODEL_OWNER_EMAIL||'').trim().toLowerCase()}
function configured(){return (['deepseek','glm'] as const).filter(provider=>{const prefix=provider.toUpperCase();return !!(process.env[prefix+'_API_KEY']&&process.env[prefix+'_MODEL'])})}
export function environmentModels(email:string){if(!environmentAccess(email))return [];const available=configured(),preferred=process.env.DEFAULT_MODEL_PROVIDER;const fallback=available.includes(preferred as Provider)?preferred:available[0];return available.map(provider=>({provider,name:presets[provider].name,model:process.env[provider.toUpperCase()+'_MODEL']!,isDefault:provider===fallback,source:'environment' as const}))}
export function environmentAgent(email:string,provider?:Provider){const available=environmentModels(email),selected=available.find(item=>provider?item.provider===provider:item.isDefault);assert(selected,422,'服务器模型未开放或配置不完整，请使用个人 Agent 配置');const prefix=selected.provider.toUpperCase(),baseUrl=validateBase(process.env[prefix+'_BASE_URL']||presets[selected.provider].baseUrl);return {id:null,name:'系统 · '+selected.name,provider:selected.provider,route:baseUrl===presets[selected.provider].baseUrl?'official':'third-party',protocol:'chat',baseUrl,model:selected.model,keyCipher:encrypt(process.env[prefix+'_API_KEY']!),timeout:90,retries:1,maxTokens:DEFAULT_MAX_OUTPUT_TOKENS,temperature:null,isDefault:true}}
