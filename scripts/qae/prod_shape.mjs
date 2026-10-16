// Get exact columns + sample rows from prod qae-c99-stress
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

const cols = async (t) => {
  const r = await client.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='${t}' AND table_schema='public' ORDER BY ordinal_position`);
  console.log(`\n### ${t}`);
  console.log(r.rows.map(c => `${c.column_name}:${c.data_type}`).join(' | '));
};
for (const t of ['SessionInstance','Attendance','StudentTransaction','Receipt','CenterTransaction','Expense','TeacherSettlement','AttendanceEvent','AuditLog','StudentGroup','Group','ScheduleSlot'])
  await cols(t);

const sample = async (label, sql) => {
  const r = await client.query(sql);
  console.log(`\n=== ${label} ===`);
  for (const row of r.rows) console.log(JSON.stringify(row));
};

await sample('SAMPLE SESSION', `SELECT * FROM "SessionInstance" WHERE "centerId"='${CID}' ORDER BY date DESC LIMIT 1`);
await sample('SAMPLE ATTENDANCE', `SELECT * FROM "Attendance" WHERE "centerId"='${CID}' ORDER BY "createdAt" DESC LIMIT 2`);
await sample('SAMPLE CHARGE TXN', `SELECT * FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='CHARGE' ORDER BY "createdAt" DESC LIMIT 2`);
await sample('SAMPLE PAYMENT TXN', `SELECT * FROM "StudentTransaction" WHERE "centerId"='${CID}' AND type='PAYMENT' ORDER BY "createdAt" DESC LIMIT 2`);
await sample('TXN TYPES', `SELECT type, COUNT(*), SUM(amount) FROM "StudentTransaction" WHERE "centerId"='${CID}' GROUP BY type`);
await sample('SLOT DISTRIBUTION', `SELECT "dayOfWeek", COUNT(*) n, MIN("startTime") mn, MAX("startTime") mx FROM "ScheduleSlot" WHERE "centerId"='${CID}' GROUP BY "dayOfWeek" ORDER BY "dayOfWeek"`);
await sample('GROUPS', `SELECT g.id, g.name, g."sessionPrice", g."teacherPercent", g."teacherId", s.name subject, COUNT(sg.id) regs FROM "Group" g LEFT JOIN "Subject" s ON s.id=g."subjectId" LEFT JOIN "StudentGroup" sg ON sg."groupId"=g.id WHERE g."centerId"='${CID}' GROUP BY g.id, g.name, g."sessionPrice", g."teacherPercent", g."teacherId", s.name ORDER BY g.name`);
await sample('AUX COUNTS', `
  SELECT 'attEvent' k, COUNT(*) n FROM "AttendanceEvent" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'audit', COUNT(*) FROM "AuditLog" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'cashday', COUNT(*) FROM "CashDay" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'notifAttempt', COUNT(*) FROM "NotificationAttempt" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'msgQueue', COUNT(*) FROM "MessageQueueItem" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'announcements', COUNT(*) FROM "Announcement" WHERE "centerId"='${CID}'
  UNION ALL SELECT 'studentsActive', COUNT(*) FROM "Student" WHERE "centerId"='${CID}' AND status='ACTIVE'
`);
await sample('BALANCE DIST', `SELECT SUM(amount) total, SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) paid, SUM(CASE WHEN amount<0 THEN amount ELSE 0 END) charged FROM "StudentTransaction" WHERE "centerId"='${CID}'`);
await client.end();
console.log('\nDONE');
