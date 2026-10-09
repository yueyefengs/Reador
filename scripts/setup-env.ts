import { randomBytes } from 'node:crypto';
import { access, writeFile, mkdir } from 'node:fs/promises';
await mkdir('storage',{recursive:true,mode:0o700});
try{await access('.env.local');console.log('.env.local 已存在，保留原配置')}catch{await mkdir('storage',{recursive:true,mode:0o700});const password=randomBytes(24).toString('hex');await writeFile('.env.local',`DATABASE_URL=postgres://reador:${password}@localhost:5433/reador\nPOSTGRES_PASSWORD=${password}\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nAPP_ORIGIN=http://localhost:3112\nAPP_PORT=3112\nLOCAL_UID=${process.getuid?.()||1000}\nLOCAL_GID=${process.getgid?.()||1000}\nCOOKIE_SECURE=false\nUPLOAD_DIR=./storage\n`,{mode:0o600});console.log('已生成 .env.local；密钥未输出')}
