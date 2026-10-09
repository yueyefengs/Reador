import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
const globalDb=globalThis as unknown as {readorSql?:ReturnType<typeof postgres>};
export const client=globalDb.readorSql??postgres(process.env.DATABASE_URL||'postgres://reador:reador@localhost:5433/reador',{max:10,prepare:false,onnotice:()=>{}});
if(process.env.NODE_ENV!=='production')globalDb.readorSql=client;
export const db=drizzle(client,{schema});
