// Deep inspect: User columns, QAE center contents in production
import { readFileSync } from 'fs';
import { Client } from 'pg';

const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();

const client = new Client({
  host: 'aws-0-eu-west-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.ttydfyqwzkwivucgiegy',
  password: PWD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
await client.connect();

// 1. User table columns
const cols = await client.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='User'
  ORDER BY ordinal_position`);
console.log('=== User COLUMNS ===');
console.log(cols.rows.map((r) => `${r.column_name}(${r.data_type})`).join(', '));

// 2. Users with password-ish column (detect name dynamically)
const pwCol = cols.rows.find((r) => /pass/i.test(r.column_name))?.column_name;
console.log('\npassword column =', pwCol || 'NONE FOUND');

if (pwCol) {
  const users = await client.query(`
    SELECT u.id, u.username, u.role, u."centerId", c.slug as "centerSlug", u."isActive",
           CASE WHEN u."${pwCol}" IS NULL THEN 'NULL'
                WHEN u."${pwCol}" = '' THEN 'EMPTY'
                WHEN u."${pwCol}" LIKE 'scrypt:%' THEN 'scrypt-ok'
                ELSE 'OTHER:' || left(u."${pwCol}", 15) END as pw
    FROM "User" u LEFT JOIN "Center" c ON c.id = u."centerId"
    ORDER BY c.slug NULLS LAST, u.username`);
  console.log('\n=== USERS (' + users.rows.length + ') ===');
  for (const u of users.rows)
    console.log(`${u.username} | role=${u.role} | center=${u.centerSlug || '?'} | active=${u.isActive} | pw=${u.pw}`);
}

// 3. QAE center data counts
const qaeId = 'cmvaippgj0000py23e2mm9ewz';
const counts = {};
for (const t of ['Student', 'Group', 'ScheduleSlot', 'SessionInstance', 'Attendance', 'StudentTransaction', 'Teacher', 'User']) {
  try {
    const r = await client.query(`SELECT COUNT(*)::int as n FROM "${t}" WHERE "centerId" = $1`, [qaeId]);
    counts[t] = r.rows[0].n;
  } catch (e) {
    counts[t] = 'ERR:' + String(e.message).slice(0, 40);
  }
}
console.log('\n=== QAE CENTER (prod) DATA COUNTS ===');
console.log(JSON.stringify(counts, null, 2));

// 4. Real centers data counts (just to know scale - DO NOT TOUCH)
for (const [name, id] of [['alnokhba-elite', 'cmufick570003iqo9fnqvrh2c'], ['amal-center', 'cmufick580004iqo9m9pa7nmh']]) {
  const r = await client.query(`SELECT COUNT(*)::int as n FROM "Student" WHERE "centerId" = $1`, [id]);
  const u = await client.query(`SELECT COUNT(*)::int as n FROM "User" WHERE "centerId" = $1`, [id]);
  console.log(`${name}: students=${r.rows[0].n}, users=${u.rows[0].n}`);
}

await client.end();
console.log('\nDONE');
