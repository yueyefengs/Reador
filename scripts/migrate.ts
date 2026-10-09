import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db,client } from '../src/lib/db';
await migrate(db,{migrationsFolder:'drizzle'});
await client.end();
console.log('数据库迁移完成');
