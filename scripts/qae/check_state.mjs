// Check current data state of qae-c99-stress (correct prod table names)
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
const CID = 'cmvaippgj0000py23e2mm9ewz';

const q = async (label, sql) => {
  const r = await client.query(sql);
  console.log(`\n=== ${label} ===`);
  for (const row of r.rows) console.log(JSON.stringify(row));
  return r;
};

await q('LATEST ACTIVITY DATES', `
  SELECT 'attendance' src, MAX("createdAt")::text latest, COUNT(*) cnt FROM "Attendance" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'student_txn', MAX("createdAt")::text, COUNT(*) FROM "StudentTransaction" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'receipt', MAX("createdAt")::text, COUNT(*) FROM "Receipt" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'session', MAX("date")::text, COUNT(*) FROM "SessionInstance" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'student', MAX("createdAt")::text, COUNT(*) FROM "Student" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'settlement', MAX("createdAt")::text, COUNT(*) FROM "TeacherSettlement" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'expense', MAX("createdAt")::text, COUNT(*) FROM "CenterTransaction" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'announcement', MAX("createdAt")::text, COUNT(*) FROM "Announcement" WHERE "centerId"='${CID}'
`);

await q('SESSIONS BY DATE (last 10)', `
  SELECT date::text, COUNT(*) n,
         SUM(CASE WHEN status='SCHEDULED' THEN 1 ELSE 0 END) sched,
         SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) done,
         SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) cancelled
  FROM "SessionInstance" WHERE "centerId"='${CID}'
  GROUP BY date ORDER BY date DESC LIMIT 10
`);

await q('DISTINCT SESSION STATUSES', `
  SELECT status, COUNT(*) n FROM "SessionInstance" WHERE "centerId"='${CID}' GROUP BY status
`);

await q('STALE OPEN SESSIONS (not DONE, past)', `
  SELECT date::text, status, COUNT(*) n FROM "SessionInstance"
  WHERE "centerId"='${CID}' AND status <> 'DONE' AND date::date < CURRENT_DATE
  GROUP BY date, status ORDER BY date LIMIT 15
`);

await q('STUDENT BALANCE SANITY', `
  SELECT COUNT(*) FILTER (WHERE balance < 0) debtors,
         COUNT(*) FILTER (WHERE balance > 0) creditors,
         ROUND(AVG(balance)::numeric,1) avg_bal, MIN(balance) min_bal
  FROM "Student" WHERE "centerId"='${CID}' AND "isActive"=true
`);

await q('RECEIPT TAIL', `
  SELECT * FROM "Receipt" WHERE "centerId"='${CID}' ORDER BY "createdAt" DESC LIMIT 2
`);

await q('ATTENDANCE STATUS MIX (last 3 days)', `
  SELECT si.date::text, a.status, COUNT(*) n FROM "Attendance" a
  JOIN "SessionInstance" si ON si.id=a."sessionId"
  WHERE a."centerId"='${CID}' AND si.date::date >= CURRENT_DATE - 3
  GROUP BY si.date, a.status ORDER BY si.date DESC
`);

await client.end();
console.log('\nDONE');
