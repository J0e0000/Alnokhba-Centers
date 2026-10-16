// Verify inserted rows + app-level sanity on prod
import { readFileSync } from 'fs';
import { Client } from 'pg';
const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();
const client = new Client({
  host: 'aws-0-eu-west-2.pooler.supabase.com', port: 6543,
  user: 'postgres.ttydfyqwzkwivucgiegy', password: PWD, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await client.connect();
const CID = 'cmvaippgj0000py23e2mm9ewz';
const q = async (label, sql) => {
  const r = await client.query(sql);
  console.log(`\n=== ${label} ===`);
  for (const row of r.rows) console.log(JSON.stringify(row));
};

await q('TODAY TOPUPS', `SELECT id, amount, reason, "createdAt" FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' AND "createdAt"::date=CURRENT_DATE ORDER BY "createdAt" LIMIT 4`);
await q('TODAY TOPUP WINDOW', `SELECT MIN("createdAt")::text mn, MAX("createdAt")::text mx, COUNT(*) n FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' AND "createdAt"::date=CURRENT_DATE`);
await q('SATURDAY OPEN SESSIONS', `SELECT id, date, "startTime", status, "openedBy" IS NOT NULL opened, price FROM "SessionInstance" WHERE "centerId"='${CID}' AND date='2026-10-17' ORDER BY "startTime" LIMIT 4`);
await q('BALANCE CONSISTENCY (sum txns = sane)', `SELECT SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) inflow, SUM(CASE WHEN amount<0 THEN amount ELSE 0 END) outflow, COUNT(*) n FROM "StudentTransaction" WHERE "centerId"='${CID}'`);
await q('IDEMPOTENCY KEYS DISTINCT', `SELECT COUNT(DISTINCT "idemKey"), COUNT(*) FROM "StudentTransaction" WHERE "centerId"='${CID}' AND "idemKey" LIKE 'simc-%'`);
await client.end();
console.log('\nDONE');
