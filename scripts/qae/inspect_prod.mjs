// Inspect production Supabase DB: tables, centers, users
import { readFileSync } from 'fs';
import { Client } from 'pg';

const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();
const HOST = 'aws-0-eu-west-2.pooler.supabase.com';
const REF = 'ttydfyqwzkwivucgiegy';

const client = new Client({
  host: HOST,
  port: 5432,
  user: `postgres.${REF}`,
  password: PWD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
await client.connect();

// 1. Tables
const tables = await client.query(`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename`);
console.log('=== TABLES (' + tables.rows.length + ') ===');
console.log(tables.rows.map((r) => r.tablename).join(', '));

// 2. Centers
const centers = await client.query(`SELECT id, name, slug FROM "Center" ORDER BY "createdAt"`);
console.log('\n=== CENTERS (' + centers.rows.length + ') ===');
for (const c of centers.rows) console.log(`${c.id} | ${c.slug} | ${c.name}`);

// 3. Users (no password leak, just structure)
const users = await client.query(`
  SELECT u.id, u.username, u.role, u."centerId", c.name as "centerName", u."isActive",
         CASE WHEN u.password IS NULL THEN 'NULL'
              WHEN u.password = '' THEN 'EMPTY'
              WHEN u.password LIKE 'scrypt:%' THEN 'scrypt-ok'
              ELSE 'MALFORMED:' || left(u.password, 20) END as "pwState"
  FROM "User" u LEFT JOIN "Center" c ON c.id = u."centerId"
  ORDER BY u."centerId", u.username`);
console.log('\n=== USERS (' + users.rows.length + ') ===');
for (const u of users.rows)
  console.log(`${u.username} | role=${u.role} | center=${u.centerName || u.centerId} | active=${u.isActive} | pw=${u.pwState}`);

// 4. Student counts per center
const students = await client.query(`
  SELECT c.name, COUNT(s.id) as cnt FROM "Center" c
  LEFT JOIN "Student" s ON s."centerId" = c.id
  GROUP BY c.id, c.name ORDER BY cnt DESC`);
console.log('\n=== STUDENTS PER CENTER ===');
for (const s of students.rows) console.log(`${s.name}: ${s.cnt}`);

// 5. Does a QAE center exist?
const qae = await client.query(`SELECT id, name, slug FROM "Center" WHERE slug LIKE 'qae%' OR name ILIKE '%qae%'`);
console.log('\n=== QAE CENTER IN PROD? ===', qae.rows.length ? JSON.stringify(qae.rows) : 'NOT FOUND');

await client.end();
console.log('\nDONE');
