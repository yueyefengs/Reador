import { createHash } from 'node:crypto';
import { S3Client,GetObjectCommand } from '@aws-sdk/client-s3';
import type qiniu from 'qiniu';
import { assert,AppError } from './errors';
const regions:Record<string,string>={z0:'cn-east-1','cn-east-1':'cn-east-1','cn-east-2':'cn-east-2',z1:'cn-north-1',z2:'cn-south-1',na0:'us-north-1',as0:'ap-southeast-1','ap-southeast-2':'ap-southeast-2','ap-southeast-3':'ap-southeast-3','cn-north-1':'cn-north-1','cn-south-1':'cn-south-1','us-north-1':'us-north-1','ap-southeast-1':'ap-southeast-1'};
type Cloud={bucket:string;manager:qiniu.rs.BucketManager};
let memo:{fingerprint:string;client:Promise<{client:S3Client;bucket:string}>}|undefined;
async function reader(config:Cloud){
  const access=process.env.QINIU_ACCESS_KEY!,secret=process.env.QINIU_SECRET_KEY!,bucket=process.env.QINIU_S3_BUCKET||config.bucket;
  const fingerprint=createHash('sha256').update(JSON.stringify([access,secret,bucket,process.env.QINIU_S3_REGION||''])).digest('hex');
  if(memo?.fingerprint===fingerprint)return memo.client;
  if(memo)void memo.client.then(value=>value.client.destroy()).catch(()=>{});
  const client=(async()=>{
    let code=process.env.QINIU_S3_REGION;
    if(!code){const result=await config.manager.getBucketInfo(config.bucket);assert(result.ok(),502,'无法查询七牛存储区域，请检查凭据或配置 QINIU_S3_REGION');code=String(result.data.region||'')}
    const region=regions[code];assert(region,503,'七牛 S3 区域不受支持，请核对 QINIU_S3_REGION');
    return {bucket,client:new S3Client({endpoint:'https://s3.'+region+'.qiniucs.com',region,forcePathStyle:true,maxAttempts:2,credentials:{accessKeyId:access,secretAccessKey:secret},requestHandler:{connectionTimeout:10000,requestTimeout:60000},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'})};
  })();memo={fingerprint,client};try{return await client}catch(error){if(memo?.client===client)memo=undefined;throw error}
}
export async function readQiniuS3(config:Cloud,key:string,limit:number){
  try{
    const {client,bucket}=await reader(config);const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(60000)});
    assert(result.Body,502,'七牛 S3 未返回文件内容');const body=result.Body as AsyncIterable<Uint8Array>&{destroy?:()=>void};
    if(result.ContentLength&&result.ContentLength>limit){body.destroy?.();throw new AppError(502,'云端文件超过处理限额')}
    const chunks:Buffer[]=[];let size=0;for await(const chunk of body){size+=chunk.length;if(size>limit){body.destroy?.();throw new AppError(502,'云端文件超过处理限额')}chunks.push(Buffer.from(chunk))}return Buffer.concat(chunks);
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'七牛 S3 文件读取失败，请核对空间、区域和访问权限')}
}
