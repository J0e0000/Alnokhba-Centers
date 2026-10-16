// Probe all Supabase pooler regions to find which one hosts project ttydfyqwzkwivucgiegy
import { readFileSync } from 'fs';
import { Client } from 'pg';

const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();
const REF = 'ttydfyqwzkwivucgiegy';

const REGIONS = [
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'ca-central-1', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'me-central-1', 'me-south-1', 'sa-east-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
];

const found = [];
for (const region of REGIONS) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const client = new Client({
    host,
    port: 5432,
    user: `postgres.${REF}`,
    password: PWD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 6000,
  });
  try {
    await client.connect();
    const r = await client.query('select current_database() as db, version() as v');
    console.log(`✅ FOUND: ${host} -> ${r.rows[0].db}`);
    console.log(`   version: ${r.rows[0].v.slice(0, 60)}`);
    found.push(host);
    await client.end();
    break; // stop at first success
  } catch (e) {
    const msg = String(e.message || e).slice(0, 90).replace(/\n/g, ' ');
    console.log(`✗ ${region}: ${msg}`);
    try { await client.end(); } catch {}
  }
}
if (!found.length) {
  console.log('\n❌ No region worked. Check if project is paused or password wrong.');
  process.exit(1);
}
