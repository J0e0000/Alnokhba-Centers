// List actual tables in production Supabase
import { readFileSync } from 'fs';
import { Client } from 'pg';

const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();
const client = new Client({
  host: 'aws-0-eu-west-2.pooler.supabase.com',
  port: 6543,
  user: 'postgres.ttydfyqwzkwivucgiegy',
  password: PWD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await client.connect();

const t = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
console.log('TABLES:', t.rows.map(r => r.tablename).join(', '));
await client.end();
