// test_new_url.ts — اختبار الرابط الجديد مباشرة من الـ sandbox (نفس دلالات Prisma في فك الترميز)
// الاستخدام: NK_TEST_URL="postgres://..." npx tsx scripts/test_new_url.ts
import pg from "pg";

async function main() {
  const url = process.env.NK_TEST_URL ?? "";
  if (!url.startsWith("postgres")) {
    console.log("مفيش رابط — مرر NK_TEST_URL");
    process.exit(1);
  }
  console.log("target:", url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"));

  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    const r = await c.query("SELECT 1 AS ok, current_user AS usr, version() AS v");
    console.log("SELECT 1 =>", r.rows[0].ok, "| user:", r.rows[0].usr, "|", String(r.rows[0].v).split(",")[0]);
    await c.end();
    console.log("RESULT: الرابط شغال 100% ✓ — المشكلة يبقى في جانب Vercel (env مش متطبق على النشر)");
  } catch (e: any) {
    console.log("RESULT: فشل الاتصال ✗ =>", String(e?.message ?? e).slice(0, 250));
  }
}
main();
