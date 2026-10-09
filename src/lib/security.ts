import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { assert } from './errors';
const scrypt=promisify(scryptCb);
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64) as Buffer;return salt+':'+hash.toString('hex')}
export async function verifyPassword(password:string,stored:string){const [salt,hash]=stored.split(':');const candidate=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(hash,'hex');return candidate.length===expected.length&&timingSafeEqual(candidate,expected)}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function encryptionKey(){const key=process.env.ENCRYPTION_KEY;assert(key&&/^[a-f0-9]{64}$/i.test(key),503,'服务端尚未配置有效的密钥加密参数');return Buffer.from(key,'hex')}
export function encrypt(secret:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(item=>item.toString('base64')).join('.')}
export function decrypt(value:string){const [iv,tag,data]=value.split('.').map(item=>Buffer.from(item,'base64'));const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8')}
