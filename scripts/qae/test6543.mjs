import { readFileSync } from 'fs';
import { Client } from 'pg';
const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();
const c = new Client({ host: 'aws-0-eu-west-2.pooler.supabase.com', port: 6543, user: 'postgres.ttydfyqwzkwivucgiegy', password: PWD, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
await c.connect();
const r = await c.query('select count(*)::int n from "User"');
console.log('✅ 6543 (pgbouncer transaction mode) OK, users:', r.rows[0].n);
await c.end();
