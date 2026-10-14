// probe_refs.ts — تحديد الـ ref الصحيح لـ Supabase عبر استجابات Supavisor:
//   wrong ref  → "tenant/user ... not found"
//   right ref  → خطأ auth مختلف (أو نجاح لو الباسورد صح)
// كل النتائج معماة — الباسورد لا يُطبع أبدًا.
import pg from "pg";

const PASS_ENC = process.env.NK_PASS_ENC ?? "";
if (!PASS_ENC) { console.log("مرر NK_PASS_ENC"); process.exit(1); }
const PORT = process.env.NK_PORT ?? "6543";
const REF_OVERRIDE = process.env.NK_REF_OVERRIDE ?? "";

const base = REF_OVERRIDE || "ttydfyqwzkiwuvcgiegy";
// i في الموقعين 11 و17 (0-indexed 10 و16) ممكن يكون i/l/1
const subs = ["i", "l", "1"];
const candidates = new Set<string>();
if (REF_OVERRIDE) { candidates.add(base); }
else {
  for (const a of subs) for (const b of subs) {
    const arr = base.split("");
    arr[10] = a; arr[16] = b;
    candidates.add(arr.join(""));
  }
  candidates.add(base);
}

async function tryRef(ref: string): Promise<string> {
  const url = `postgres://postgres.${ref}:${PASS_ENC}@aws-0-eu-west-2.pooler.supabase.com:${PORT}/postgres?pgbouncer=true`;
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    await c.query("SELECT 1");
    await c.end();
    return "SUCCESS ✓✓✓";
  } catch (e: any) {
    try { await c.end(); } catch {}
    const m = String(e?.message ?? e);
    if (/not found/i.test(m)) return "wrong-tenant";
    if (/password/i.test(m) || /auth/i.test(m) || /credential/i.test(m)) return "RIGHT-TENANT-but-auth-failed: " + m.slice(0, 120);
    return "other: " + m.slice(0, 120);
  }
}

async function main() {
  for (const ref of candidates) {
    const res = await tryRef(ref);
    console.log(`${ref} -> ${res}`);
    if (res.startsWith("SUCCESS")) { console.log("\nCORRECT_REF=" + ref); return; }
  }
  console.log("\nولا مرشح اشتغل — محتاجين السطر الجاهز من زر Connect");
}
main();
