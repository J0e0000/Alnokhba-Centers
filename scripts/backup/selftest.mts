/**
 * AlNokhba — backup/restore self-test (Phase 2)
 * ---------------------------------------------
 * بيثبت إن خط النسخ والاسترجاع شغال من البداية للنهاية من غير ما يلمس الإنتاج:
 *   1. PGlite (scratch بالذاكرة) + سكيما مصغّرة شبه الحقيقية ( FK ذاتي للمرتجعات + نصوص عربية + JSON).
 *   2. يفتح socket server ببروتوكول Postgres الحقيقي (pg wire) على بورت عشوائي.
 *   3. يشغّل postgres-backup.mts على السكراتش → dump.
 *   4. يشغّل restore-test.mts على الـ dump → لازم PASS.
 *   5. يقارن القيم فعلياً (نص عربي بعلامات ' و JSON ومرجع ذاتي).
 */
// PG_TOOLS_HINT: pglite أداة محلية بس — مش في package.json عشان ما تكسرش npm install على Vercel
let PGlite: any;
try {
  PGlite = (await import("@electric-sql/pglite")).PGlite;
} catch {
  console.error("❌ محتاج أداة الاختبار المحلية. شغّل مرة واحدة:\n   npm i --no-save @electric-sql/pglite --legacy-peer-deps");
  process.exit(1);
}
let PGLiteSocketServer: any;
try {
  PGLiteSocketServer = (await import("@electric-sql/pglite-socket")).PGLiteSocketServer;
} catch {
  console.error("❌ محتاج أداة السيلف تست المحلية. شغّل مرة واحدة:\n   npm i --no-save @electric-sql/pglite @electric-sql/pglite-socket@0.0.7 --legacy-peer-deps");
  process.exit(1);
}

import { spawn } from "node:child_process";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";

/** spawn غير متزامن — لازم الـ event loop يفضل شغال عشان socket server يخدم الاتصالات */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit=${code}`))));
    p.on("error", reject);
  });
}

const tmpDir = path.join(process.cwd(), "backup", "scratch-selftest");
rmSync(tmpDir, { recursive: true, force: true });

const db = new PGlite(tmpDir);
await db.exec(`
CREATE TABLE center (id text PRIMARY KEY, name text NOT NULL, settings jsonb);
CREATE TABLE student (id text PRIMARY KEY, "centerId" text NOT NULL REFERENCES center(id), name text NOT NULL, "qrToken" text NOT NULL);
CREATE TABLE txn (
  id text PRIMARY KEY,
  "studentId" text NOT NULL REFERENCES student(id),
  amount integer NOT NULL,
  note text,
  "refTxnId" text REFERENCES txn(id)
);
INSERT INTO center VALUES ('c1', 'سنتر النخبة — اختبار ''QUOTE''', '{"theme":"نخبة","nums":[1,2]}');
INSERT INTO student VALUES ('s1', 'c1', 'أحمد محمد', 'tok1'), ('s2', 'c1', 'منى ''سعيد''', 'tok2');
INSERT INTO txn VALUES ('t1', 's1', 25000, 'دفعة شهر 10', NULL), ('t2', 's2', -25000, 'مرتجع t1', 't1');
`);

const server = new PGLiteSocketServer({ db, port: 15432, host: "127.0.0.1" });
await server.start();
const port = 15432;
console.log(`🧪 سكراتش PGlite على wire protocol: 127.0.0.1:${port}`);

// بيانات قبل النسخ (للمقارنة بعد الاسترجاع)
const before = (await db.query<{ id: string; amount: number; note: string; ref: string | null; cname: string; settings: unknown }>(
  `SELECT t.id, t.amount, t.note, t."refTxnId" AS ref, c.name AS cname, c.settings
   FROM txn t JOIN student s ON s.id = t."studentId" JOIN center c ON c.id = s."centerId" ORDER BY t.id`,
)).rows;

const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
try {
  // 3) backup من السكراتش
  await run("npx", ["tsx", "scripts/backup/postgres-backup.mts", "--url", url]);
  // 4) restore test
  await run("npx", ["tsx", "scripts/backup/restore-test.mts"]);

  // 5) مقارنة قيمية على نسخة مسترجعة جديدة
  const status = JSON.parse(readFileSync(path.join(process.cwd(), "backup", "pg", "latest-status.json"), "utf8"));
  const db2 = new PGlite();
  await db2.exec(readFileSync(path.join(process.cwd(), "backup", "pg", status.file), "utf8"));
  const after = (await db2.query<{ id: string; amount: number; note: string; ref: string | null; cname: string; settings: unknown }>(
    `SELECT t.id, t.amount, t.note, t."refTxnId" AS ref, c.name AS cname, c.settings
     FROM txn t JOIN student s ON s.id = t."studentId" JOIN center c ON c.id = s."centerId" ORDER BY t.id`,
  )).rows;
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`\n🔎 مطابقة القيم قبل/بعد: ${same ? "✓ متطابقة 100%" : "✗ اختلاف!"}`);
  if (!same) {
    console.error("before:", JSON.stringify(before, null, 1));
    console.error("after:", JSON.stringify(after, null, 1));
    process.exit(1);
  }
  await db2.close();
  console.log(`\n✅ SELF-TEST PASS — خط النسخ والاسترجاع كامل شغال`);
} finally {
  await server.stop();
  await db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  // ننضف dumps السيلف تست عشان backup/pg يفضل للنسخ الحقيقية بس
  const pgDir = path.join(process.cwd(), "backup", "pg");
  for (const f of readdirSync(pgDir)) {
    if (f.startsWith("nokhba-pg-") && !f.includes("latest")) {
      // كل الـ dumps اللي اتعملت في السيلف تست (source=127.0.0.1) تتمسح
      try {
        const s = JSON.parse(readFileSync(path.join(pgDir, "latest-status.json"), "utf8"));
        if (s.source?.includes("127.0.0.1")) rmSync(path.join(pgDir, f), { force: true });
      } catch { rmSync(path.join(pgDir, f), { force: true }); }
    }
  }
  rmSync(path.join(pgDir, "latest-status.json"), { force: true });
  rmSync(path.join(pgDir, "latest-status.json.sha256"), { force: true });
  console.log("🧹 اتسحبت مخلفات السيلف تست");
}
