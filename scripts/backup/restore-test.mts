/**
 * AlNokhba — Restore test (Phase 2: platform backup/DR)
 * ------------------------------------------------------
 * بيأكد إن آخر dump منطقي قابل للاسترجاع فعلاً:
 *   1. يتحقق من sha256 بتاع الملف.
 *   2. يرجّعه في PGlite (Postgres حقيقي in-process — scratch معزول بالذاكرة).
 *   3. يقارن عدد الصفوف لكل جدول بين الميتاداتا واللي اترجّع.
 *   4. يجرب التحقق من قيود FK (اتضافت بعد البيانات في الـ dump).
 *   5. يكتب نتيجة التحقق في backup/pg/latest-status.json (validated: true/false).
 *
 * ⚠️ السكريبت ده عمره ما بيتصل بقاعدة الإنتاج — بيكترح ملف الـ dump بس.
 *
 * الاستخدام:
 *   npx tsx scripts/backup/restore-test.mts [backup/pg/nokhba-pg-XXX.sql]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// PG_TOOLS_HINT: pglite أداة محلية بس — مش في package.json عشان ما تكسرش npm install على Vercel
let PGlite: any;
try {
  PGlite = (await import("@electric-sql/pglite")).PGlite;
} catch {
  console.error("❌ محتاج أداة الاختبار المحلية. شغّل مرة واحدة:\n   npm i --no-save @electric-sql/pglite --legacy-peer-deps");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "backup", "pg");

function latestDump(): string {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  if (!existsSync(outDir)) {
    console.error("❌ مفيش مجلد backup/pg — شغّل postgres-backup.mts الأول");
    process.exit(1);
  }
  const dumps = readdirSync(outDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (dumps.length === 0) {
    console.error("❌ مفيش ملفات dump — شغّل postgres-backup.mts الأول");
    process.exit(1);
  }
  return path.join(outDir, dumps[dumps.length - 1]);
}

async function main() {
  const file = latestDump();
  const statusPath = path.join(outDir, "latest-status.json");
  console.log(`🧪 اختبار استرجاع: ${path.basename(file)}`);

  // 1) تحقق سلامة الملف
  const body = readFileSync(file, "utf8");
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const shaFile = `${file}.sha256`;
  if (existsSync(shaFile)) {
    const expected = readFileSync(shaFile, "utf8").trim().split(/\s+/)[0];
    if (expected !== sha) {
      console.error(`❌ فشل تحقق sha256! متوقع ${expected.slice(0, 16)}… فعلي ${sha.slice(0, 16)}…`);
      process.exit(1);
    }
    console.log(`🔐 sha256 ✓ (${sha.slice(0, 16)}…)`);
  } else {
    console.warn("⚠️ مفيش ملف sha256 جانب الـ dump — اتخطى الفحص");
  }

  // 2) استرجاع في PGlite (scratch — بالذاكرة)
  const db = new PGlite();
  const t0 = Date.now();
  try {
    await db.exec(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`❌ الاسترجاع فشل: ${msg.slice(0, 300)}`);
    if (existsSync(statusPath)) {
      const s = JSON.parse(readFileSync(statusPath, "utf8"));
      if (s.file === path.basename(file)) {
        s.validated = false;
        s.validationError = msg.slice(0, 200);
        s.validatedAt = new Date().toISOString();
        writeFileSync(statusPath, JSON.stringify(s, null, 2), { mode: 0o600 });
      }
    }
    process.exit(1);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`📥 الاسترجاع نجح في ${secs}s`);

  // 3) مقارنة عدد الصفوف لكل جدول
  const status = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8")) : null;
  const expectedCounts: Record<string, number> | null = status?.file === path.basename(file) ? status.tables : null;
  const tables = (
    await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
    )
  ).rows.map((r) => r.table_name);

  let mismatch = 0;
  const results: { table: string; expected: number | "?"; restored: number }[] = [];
  for (const t of tables) {
    const restored = Number((await db.query<{ c: string }>(`SELECT count(*) AS c FROM "${t}"`)).rows[0].c);
    const expected = expectedCounts ? expectedCounts[t] : "?";
    if (typeof expected === "number" && expected !== restored) mismatch++;
    results.push({ table: t, expected, restored });
  }

  console.log(`\n📊 الجداول المُسترجعة (${tables.length}):`);
  for (const r of results) {
    const mark = r.expected === "?" ? "·" : r.expected === r.restored ? "✓" : "✗";
    console.log(`  ${mark} ${r.table.padEnd(24)} متوقع=${r.expected} مسترجع=${r.restored}`);
  }

  // 4) تحقق إن الـ FK قيود موجودة فعلاً (اتضافت بعد البيانات)
  const fkCount = Number(
    (
      await db.query<{ c: string }>(
        `SELECT count(*) AS c FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`,
      )
    ).rows[0].c,
  );
  console.log(`\n🔗 قيود FK المضافة: ${fkCount}`);

  await db.close();

  const pass = mismatch === 0 && (expectedCounts ? tables.every((t) => t in expectedCounts) : true);
  if (status && status.file === path.basename(file)) {
    status.validated = pass;
    status.validatedAt = new Date().toISOString();
    status.restoredTables = tables.length;
    status.restoredFkConstraints = fkCount;
    if (!pass) status.validationError = `mismatch=${mismatch}`;
    writeFileSync(statusPath, JSON.stringify(status, null, 2), { mode: 0o600 });
  }

  if (pass) {
    console.log(`\n✅ PASS — النسخة الاحتياطية قابلة للاسترجاع بالكامل (${tables.length} جدول، ${fkCount} FK)`);
  } else {
    console.error(`\n❌ FAIL — ${mismatch} جدول بعدد صفوف مختلف!`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌ خطأ غير متوقع:", e);
  process.exit(1);
});
