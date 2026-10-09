import { randomUUID } from 'node:crypto';
import { writeStoredFile,readStoredFile,deleteStoredFile,storageBackend } from '../src/lib/storage';
import { parseDocument } from '../src/modules/books/parse';
import { makePdf } from '../tests/fixtures';
import { AppError } from '../src/lib/errors';
try{process.loadEnvFile('.env')}catch{}
try{process.loadEnvFile('.env.local')}catch{}
process.env.STORAGE_BACKEND='qiniu';
let reference:string|undefined;
try{
  if(storageBackend()!=='qiniu')throw new AppError(422,'请先配置七牛存储');
  const original=makePdf();reference=await writeStoredFile(randomUUID(),randomUUID(),'PDF',original);
  const restored=await readStoredFile(reference);if(!original.equals(restored))throw new AppError(502,'原书下载字节不一致');
  const chapters=await parseDocument(restored,'PDF');if(chapters.length!==2)throw new AppError(502,'云端原书解析未通过');
  console.log('七牛真实验收通过：加密上传、签名下载、解密字节一致、两页 PDF 解析。');
}catch(error){console.error(error instanceof AppError?error.message:'七牛真实验收失败，未输出敏感信息');process.exitCode=1}
finally{if(reference)try{await deleteStoredFile(reference);console.log('已删除本次验收新建的云端对象。')}catch{console.error('本次验收临时对象清理失败，请检查存储服务；未操作其他对象。');process.exitCode=1}}
