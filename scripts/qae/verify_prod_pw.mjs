// Verify prod password hashes against known candidate passwords
import { readFileSync } from 'fs';
import { scryptSync, timingSafeEqual } from 'crypto';
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

function verify(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return { ok: false, reason: 'bad-format:' + scheme };
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (candidate.length !== expected.length) return { ok: false, reason: 'len-mismatch' };
    return { ok: timingSafeEqual(candidate, expected) };
  } catch (e) {
    return { ok: false, reason: 'THROWS:' + String(e.message).slice(0, 60) };
  }
}

const candidates = ['Qae#2026', 'manager123', 'Nokhba#2026', 'admin123', '123456'];

const targets = ['qae-mgr-99', 'qae-rec-99', 'qae-recl-99', 'qae-tch-99', 'manager', 'manager2', 'reception'];
for (const username of targets) {
  const r = await client.query(`SELECT username, "passwordHash" FROM "User" WHERE username = $1`, [username]);
  if (!r.rows.length) { console.log(`${username}: NOT FOUND`); continue; }
  const stored = r.rows[0].passwordHash;
  const parts = String(stored).split(':');
  console.log(`\n${username}: format=${parts[0]} saltLen=${parts[1]?.length} hashLen=${parts[2]?.length}`);
  let matched = 'NONE';
  for (const c of candidates) {
    const v = verify(c, stored);
    if (v.ok) { matched = c; break; }
  }
  console.log(`  password test => ${matched !== 'NONE' ? '✅ MATCH: ' + matched : '❌ no match among candidates'}`);
}

// Also check QAE center createdAt
const c = await client.query(`SELECT id, slug, "createdAt" FROM "Center" WHERE slug='qae-c99-stress'`);
console.log('\nQAE center createdAt:', c.rows[0]?.createdAt);

await client.end();
