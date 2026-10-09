import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq, and, gt, sql } from 'drizzle-orm';
import { db } from './db';
import { sessions, users, limits } from './schema';
import { AppError, assert } from './errors';
import { digest } from './security';
export async function currentUser(){const token=(await cookies()).get('reador_session')?.value;assert(token,401,'请先登录');const [row]=await db.select({user:users}).from(sessions).innerJoin(users,eq(users.id,sessions.ownerId)).where(and(eq(sessions.tokenHash,digest(token)),gt(sessions.expiresAt,new Date())));assert(row,401,'登录已过期，请重新登录');return row.user}
export async function createSession(ownerId:string){const token=randomBytes(32).toString('base64url');const expiresAt=new Date(Date.now()+30*86400000);await db.insert(sessions).values({tokenHash:digest(token),ownerId,expiresAt});(await cookies()).set('reador_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',path:'/',expires:expiresAt})}
export async function logout(){const cookie=await cookies();const token=cookie.get('reador_session')?.value;if(token)await db.delete(sessions).where(eq(sessions.tokenHash,digest(token)));cookie.delete('reador_session')}
export function verifyOrigin(request:Request){const origin=request.headers.get('origin');const expected=process.env.APP_ORIGIN||new URL(request.url).origin;assert(origin===expected,403,'请求来源不受信任，请从应用页面操作')}
export async function rateLimit(key:string,max=10,windowMs=15*60000){const now=new Date();const until=new Date(now.getTime()+windowMs);const [row]=await db.insert(limits).values({key:digest(key),count:1,until}).onConflictDoUpdate({target:limits.key,set:{count:sql`case when ${limits.until}<${now.toISOString()} then 1 else ${limits.count}+1 end`,until:sql`case when ${limits.until}<${now.toISOString()} then ${until.toISOString()} else ${limits.until} end`}}).returning();if(row.count>max)throw new AppError(429,'操作过于频繁，请稍后再试')}
