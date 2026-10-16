// TOPUP samples + StudentGroup status + unique constraints + per-group rates
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

await q('TOPUP SAMPLES', `SELECT * FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' ORDER BY "createdAt" DESC LIMIT 5`);
await q('TOPUP METHOD MIX', `SELECT method, COUNT(*) n FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' GROUP BY method`);
await q('TOPUP CREATEDBY MIX', `SELECT "createdBy", COUNT(*) n FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' GROUP BY "createdBy"`);
await q('TOPUP AMOUNTS', `SELECT amount, COUNT(*) n FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' GROUP BY amount ORDER BY n DESC LIMIT 12`);
await q('TOPUP BY DATE', `SELECT "createdAt"::date d, COUNT(*) n FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='TOPUP' GROUP BY 1 ORDER BY 1 DESC LIMIT 6`);
await q('SG STATUS', `SELECT sg.status, COUNT(*) FROM "StudentGroup" sg JOIN "Student" s ON s.id=sg."studentId" WHERE s."centerId"='${CID}' GROUP BY sg.status`);
await q('STUDENT STATUS', `SELECT status, COUNT(*) FROM "Student" WHERE "centerId"='${CID}' GROUP BY status`);
await q('UNIQUE INDEXES', `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('Attendance','StudentTransaction') AND indexdef ILIKE '%unique%'`);
await q('PER-GROUP RATES', `
  SELECT g.id, g.name, COUNT(DISTINCT s2.id) FILTER (WHERE s.status='ACTIVE' AND (sg.status IS NULL OR sg.status='ACTIVE')) active_regs,
         COUNT(DISTINCT si.id) sessions, COUNT(a.id) att
  FROM "Group" g
  LEFT JOIN "StudentGroup" sg ON sg."groupId"=g.id
  LEFT JOIN "Student" s ON s.id=sg."studentId"
  LEFT JOIN "SessionInstance" si ON si."groupId"=g.id AND si.status='CLOSED'
  LEFT JOIN "Attendance" a ON a."sessionId"=si.id
  WHERE g."centerId"='${CID}'
  GROUP BY g.id, g.name ORDER BY g.name LIMIT 6
`);
await client.end();
console.log('\nDONE');
