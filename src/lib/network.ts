import { lookup } from 'node:dns/promises';
import { BlockList,isIP } from 'node:net';
import { z } from 'zod';
import { assert,AppError } from './errors';
const block=new BlockList();for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const)block.addSubnet(ip,bits);
const public6=new BlockList();public6.addSubnet('2000::',3,'ipv6');
export function isPublicAddress(ip:string){return isIP(ip)===4?!block.check(ip,'ipv4'):isIP(ip)===6&&public6.check(ip,'ipv6')&&!ip.toLowerCase().startsWith('2001:db8:')}

const dnsSchema=z.object({Status:z.number().int(),Answer:z.array(z.object({type:z.number().int(),data:z.string(),TTL:z.number().int().optional()})).max(128).optional()});
export function parseDnsAnswer(raw:unknown){const data=dnsSchema.parse(raw);assert(data.Status===0,502,'公网 DNS 未能解析模型域名');const addresses=(data.Answer||[]).filter(item=>item.type===1).map(item=>item.data);assert(addresses.length&&addresses.every(ip=>isIP(ip)===4&&isPublicAddress(ip)),422,'公网 DNS 结果无有效公网地址');return addresses.map(address=>({address,family:4}))}
const cached=new Map<string,{until:number;addresses:{address:string;family:number}[]}>();
export async function resolveModelHost(host:string){
  const family=isIP(host);if(family)return [{address:host,family}];
  const mode=process.env.AI_DNS_MODE||'system';assert(['system','doh'].includes(mode),503,'AI_DNS_MODE 配置无效');
  if(mode==='system'){try{return await lookup(host,{all:true})}catch{throw new AppError(502,'无法解析模型域名，请检查服务地址与 DNS 配置')}}
  const prior=cached.get(host);if(prior&&prior.until>Date.now())return prior.addresses;
  // 显式启用的公网 DNS，仅发送域名；固定 IP 避免依赖本机代理的 Fake-IP 解析。
  try{
    const response=await fetch('https://1.1.1.1/dns-query?name='+encodeURIComponent(host)+'&type=A',{headers:{accept:'application/dns-json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    assert(response.ok&&response.body,502,'公网 DNS 服务暂不可用');const chunks:Buffer[]=[];let size=0;const reader=response.body.getReader();
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new AppError(502,'公网 DNS 响应超过限制')}chunks.push(Buffer.from(value))}
    const addresses=parseDnsAnswer(JSON.parse(Buffer.concat(chunks).toString()));
    if(cached.size>=128)cached.delete(cached.keys().next().value!);cached.set(host,{until:Date.now()+60000,addresses});return addresses;
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'公网 DNS 查询失败，请检查网络或改用系统 DNS')}
}
