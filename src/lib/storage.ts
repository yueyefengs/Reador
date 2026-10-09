import { resolve,sep,dirname } from 'node:path';
import { mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import { createCipheriv,createDecipheriv,hkdfSync,randomBytes } from 'node:crypto';
import qiniu from 'qiniu';
import { readQiniuS3 } from './qiniu-s3';
import { lookup } from 'node:dns/promises';
import { assert,AppError } from './errors';

const MAGIC=Buffer.from('READOR01');
const MAX_FILE_BYTES=50*1024*1024;
const PREFIX='reador/v1/';
export function storagePath(relative:string){const root=resolve(process.env.UPLOAD_DIR||'storage');const path=resolve(root,relative);assert(!relative.includes('://')&&path.startsWith(root+sep),422,'文件路径超出私有存储范围');return path}
function fileKey(){const key=process.env.ENCRYPTION_KEY;assert(key&&/^[a-f0-9]{64}$/i.test(key),503,'服务端缺少文件加密参数');return Buffer.from(hkdfSync('sha256',Buffer.from(key,'hex'),'reador-storage','qiniu-file-v1',32))}
// 对象内容绑定存储位置，公开空间也只能获取密文；更换对象不能冒充另一用户的原书。
export function sealFile(bytes:Buffer,reference:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',fileKey(),iv);cipher.setAAD(Buffer.from(reference));const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted])}
export function openFile(bytes:Buffer,reference:string){
  assert(bytes.length>=36&&bytes.subarray(0,8).equals(MAGIC),502,'云端文件格式无效');
  try{const cipher=createDecipheriv('aes-256-gcm',fileKey(),bytes.subarray(8,20));cipher.setAAD(Buffer.from(reference));cipher.setAuthTag(bytes.subarray(20,36));return Buffer.concat([cipher.update(bytes.subarray(36)),cipher.final()])}catch{throw new AppError(502,'云端文件解密失败，请核对加密密钥或文件完整性')}
}
export function storageBackend(){const backend=process.env.STORAGE_BACKEND||'local';assert(['local','qiniu'].includes(backend),503,'STORAGE_BACKEND 配置无效');return backend}
function cloud(){
  const access=process.env.QINIU_ACCESS_KEY,secret=process.env.QINIU_SECRET_KEY,bucket=process.env.QINIU_BUCKET,raw=process.env.QINIU_DOMAIN;
  assert(access&&secret&&bucket,503,'七牛存储配置不完整');assert(/^[a-zA-Z0-9_-]+$/.test(bucket),503,'七牛空间名称无效');
  const mode=process.env.QINIU_DOWNLOAD_MODE||'s3';assert(['s3','domain'].includes(mode),503,'QINIU_DOWNLOAD_MODE 配置无效');let domain='';
  if(mode==='domain'){assert(raw,503,'使用域名下载时须配置 QINIU_DOMAIN');let url:URL;try{url=new URL(raw.includes('://')?raw:'https://'+raw)}catch{throw new AppError(503,'七牛下载域名无效')}assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/',503,'七牛域名须使用 HTTPS 且不含路径或凭据');domain=url.origin}

  const config=new qiniu.conf.Config();config.useHttpsDomain=true;config.useCdnDomain=false;
  qiniu.conf.RPC_TIMEOUT=60000;
  const mac=new qiniu.auth.digest.Mac(access,secret),manager=new qiniu.rs.BucketManager(mac,config);
  return {bucket,domain,mode,config,mac,manager};
}
function cloudReference(reference:string){const match=/^qiniu:\/\/([a-zA-Z0-9_-]+)\/(reador\/v1\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(?:pdf|epub)\.enc)$/.exec(reference);assert(match,422,'云端文件位置无效');return {bucket:match[1],key:match[2]}}
function sameBucket(reference:string){const location=cloudReference(reference),config=cloud();assert(location.bucket===config.bucket,503,'当前七牛空间与原书保存位置不一致，请恢复对应存储配置');return {...location,...config}}
export async function writeStoredFile(ownerId:string,bookId:string,format:string,bytes:Buffer){
  assert(/^[a-f0-9-]{36}$/.test(ownerId)&&/^[a-f0-9-]{36}$/.test(bookId)&&['PDF','EPUB'].includes(format),422,'文件身份参数无效');assert(bytes.length<=MAX_FILE_BYTES,422,'文件超过 50 MB');
  if(storageBackend()==='local'){const reference=ownerId+'/'+bookId+'.'+format.toLowerCase(),path=storagePath(reference);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,bytes,{mode:0o600,flag:'wx'});return reference}
  const config=cloud(),key=PREFIX+ownerId+'/'+bookId+'.'+format.toLowerCase()+'.enc',reference='qiniu://'+config.bucket+'/'+key;
  if(config.mode==='domain')await lookup(new URL(config.domain).hostname).catch(()=>{throw new AppError(503,'七牛下载域名无法解析，请检查 QINIU_DOMAIN')});
  const token=new qiniu.rs.PutPolicy({scope:config.bucket+':'+key,insertOnly:1,expires:120,fsizeLimit:MAX_FILE_BYTES+36}).uploadToken(config.mac);
  const extra=new qiniu.form_up.PutExtra();extra.mimeType='application/octet-stream';
  try{const result=await new qiniu.form_up.FormUploader(config.config).put(token,key,sealFile(bytes,reference),extra);assert(result.ok(),502,'七牛上传失败，请检查空间权限与服务状态');return reference}catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'七牛上传连接失败，请稍后重试')}
}
export async function readStoredFile(reference:string){
  if(!reference.startsWith('qiniu://'))return readFile(storagePath(reference));
  const config=sameBucket(reference);if(config.mode==='s3')return openFile(await readQiniuS3(config,config.key,MAX_FILE_BYTES+36),reference);
  const signed=config.manager.privateDownloadUrl(config.domain,config.key,Math.floor(Date.now()/1000)+120);
  try{
    const result=await fetch(signed,{signal:AbortSignal.timeout(60000),redirect:'error',cache:'no-store'});assert(result.ok&&result.body,502,'七牛文件读取失败，请检查下载域名与空间配置');
    const reader=result.body.getReader(),chunks:Buffer[]=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE_BYTES+36){await reader.cancel();throw new AppError(502,'云端文件超过处理限额')}chunks.push(Buffer.from(value))}
    return openFile(Buffer.concat(chunks),reference);
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'七牛文件下载连接失败，请稍后重试')}
}
// 只用于撤回本次尚未成功入库的对象；不清理已保存的书籍或学习记录。
export async function deleteStoredFile(reference:string){
  if(!reference.startsWith('qiniu://'))return unlink(storagePath(reference));
  const config=sameBucket(reference);try{const result=await config.manager.delete(config.bucket,config.key);assert(result.ok()||result.resp.statusCode===612,502,'七牛临时文件清理失败')}catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'七牛临时文件清理连接失败')}
}
