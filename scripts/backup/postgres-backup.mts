/**
 * AlNokhba — Postgres logical backup (Phase 2: platform backup/DR)
 * ----------------------------------------------------------------
 * قراءة فقط (READ-ONLY) من قاعدة الإنتاج: مفيش أي INSERT/UPDATE/DELETE.
 * المخرجات:
 *   backup/pg/nokhba-pg-<ts>.sql      — dump منطقي (INSERTs بترتيب FK)
 *   backup/pg/nokhba-pg-<ts>.sql.sha256
 *   backup/pg/latest-status.json      — حالة آخر نسخة (تُستخدم في اختبار الاسترجاع)
 *
 * الاستخدام:
 *   npx tsx scripts/backup/postgres-backup.mts --url "$DATABASE_URL"
 *   npx tsx scripts/backup/postgres-backup.mts --url .env.vercel   # يقرأ DATABASE_URL من الملف
 *   npx tsx scripts/backup/postgres-backup.mts                     # يجرب env ثم .env.vercel ثم .env
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";

type Args = { url?: string };

function parseArgs(): Args {
  const args: Args = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--url") args.url = a[i + 1];
  }
  return args;
}

function resolveUrl(arg?: string): string {
  if (arg && arg.includes("://")) return arg;
  const candidates = [
    process.env.DATABASE_URL,
    arg, // مسار ملف env
    path.join(process.cwd(), ".env.vercel"),
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c.includes("://")) return c;
    try {
      const txt = readFileSync(c, "utf8");
      const m = txt.match(/^DATABASE_URL\s*=\s*["']?(.+?)["']?\s*$/m);
      if (m) return m[1];
    } catch { /* مفيش ملف */ }
  }
  console.error("❌ مش لاقي DATABASE_URL — مرّر --url أو env أو ملف .env.vercel");
  process.exit(1);
}

function sslFor(url: string) {
  // Supabase/Neon/pooler → TLS إجباري ( rejectUnauthorized=false عشان شهادات موقعة بـ CA داخلي )
  if (/sslmode=require|supabase|neon|pooler/i.test(url)) return { rejectUnauthorized: false };
  return undefined;
}

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'::bytea`;
  if (typeof v === "object") {
    // Json columns / arrays — JSON نص، وPostgres بيعمل cast تلقائي حسب نوع العمود
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  }
  // نص عادي — standard_conforming_strings=on → الترقيع بعلامة ' بس
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const { url: urlArg } = parseArgs();
  const url = resolveUrl(urlArg);
  const masked = url.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@");
  console.log(`🔌 المصدر: ${masked}`);

  const client = new Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();

  // لقطة متسقة: REPEATABLE READ + READ ONLY (يمنع أي كتابة حتى بالغلط)
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const tables = (
    await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'
         AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    )
  ).rows.map((r) => r.table_name);
  console.log(`📋 جداول: ${tables.length}`);

  // ترتيب طوبولوجي حسب الـ FK (Kahn) عشان الـ INSERTs تنفذ من غير انتهاك قيود
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  const fk = (
    await client.query<{ child: string; parent: string }>(
      `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
       FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`,
    )
  ).rows;
  for (const { child, parent } of fk) {
    const c = child.replace(/"/g, "");
    const p = parent.replace(/"/g, "");
    if (deps.has(c) && deps.has(p) && c !== p) deps.get(c)!.add(p);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...deps.get(t)!].every((d) => done.has(d)));
    if (ready.length === 0) {
      // دورة FK — رجوع لإدراج الباقي بترتيب أبجدي (الاسترجاع في PGlite superuser يقبل)
      ordered.push(...tables.filter((t) => !done.has(t)));
      break;
    }
    for (const t of ready) { done.add(t); ordered.push(t); }
  }

  // أعمدة كل جدول (بالترتيب) مرة واحدة
  const cols = new Map<string, string[]>();
  for (const t of ordered) {
    cols.set(
      t,
      (
        await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
          [t],
        )
      ).rows.map((r) => r.column_name),
    );
  }

  // DDL دقيق من pg_catalog (أنواع format_type + NOT NULL + default + PK/UNIQUE/FK)
  // عشان الـ dump يبقى self-contained: يترجع على قاعدة فاضية من غير prisma db push
  const ddl: string[] = [];
  for (const t of ordered) {
    const tcols = (
      await client.query<{ attname: string; ftype: string; notnull: boolean; dflt: string | null }>(
        `SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS ftype,
                a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS dflt
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [`"public"."${t}"`],
      )
    ).rows;
    const lines = tcols.map((c) => {
      const d = c.notnull ? " NOT NULL" : "";
      const f = c.dflt ? ` DEFAULT ${c.dflt}` : "";
      return `  "${c.attname}" ${c.ftype}${d}${f}`;
    });
    ddl.push(`CREATE TABLE "${t}" (\n${lines.join(",\n")}\n);`);
  }
  // القيود (PK/UNIQUE/FK) تتضاف كلها بعد إدخال البيانات — يسمح بالمراجع الذاتية والدورات
  const cons = (
    await client.query<{ conname: string; tbl: string; def: string }>(
      `SELECT conname, conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE connamespace='public'::regnamespace AND contype IN ('p','u','f')
       ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 ELSE 2 END,
                conrelid::regclass::text, conname`,
    )
  ).rows;
  const consSql = cons
    .map((c) => `ALTER TABLE "${c.tbl.replace(/"/g, "")}" ADD CONSTRAINT "${c.conname}" ${c.def};`)
    .join("\n");
  const ddlSql = `-- ===== SCHEMA: tables (constraints after data) =====\n${ddl.join("\n")}\n`;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(process.cwd(), "backup", "pg");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `nokhba-pg-${stamp}.sql`);

  const counts: Record<string, number> = {};
  const parts: string[] = [];
  parts.push(`-- AlNokhba logical backup (Phase 2)`);
  parts.push(`-- created_at: ${new Date().toISOString()}`);
  parts.push(`-- source: ${masked}`);
  parts.push(`-- tool: scripts/backup/postgres-backup.mts (READ-ONLY snapshot, REPEATABLE READ)`);
  parts.push(`-- dump ده self-contained: SCHEMA + DATA — يترجع على قاعدة فاضية على طول`);
  parts.push(`BEGIN;`);
  parts.push(ddlSql);
  for (const t of ordered) {
    const c = cols.get(t)!;
    const res = await client.query(`SELECT * FROM "${t}"`);
    counts[t] = res.rowCount ?? 0;
    parts.push(`\n-- ===== ${t} (${counts[t]} rows) =====`);
    const q = (id: string) => `"${id}"`;
    const colList = c.map(q).join(", ");
    const BATCH = 100;
    for (let i = 0; i < res.rows.length; i += BATCH) {
      const batch = res.rows.slice(i, i + BATCH);
      const values = batch
        .map((row) => `(${c.map((col) => lit(row[col])).join(", ")})`)
        .join(",\n  ");
      parts.push(`INSERT INTO ${q(t)} (${colList}) VALUES\n  ${values};`);
    }
    if (counts[t] === 0) parts.push(`-- (فاضي)`);
  }
  parts.push(`\n-- ===== SCHEMA: constraints (PK/UNIQUE/FK) =====\n${consSql}\n`);
  parts.push(`COMMIT;`);
  const body = parts.join("\n");
  writeFileSync(file, body, { mode: 0o600 });
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`, { mode: 0o600 });

  await client.query("COMMIT"); // إنهاء المعاملة للقراءة فقط
  await client.end();

  const size = statSync(file).size;
  const status = {
    file: path.basename(file),
    createdAt: new Date().toISOString(),
    source: masked,
    sizeBytes: size,
    sha256: sha,
    tables: counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    validated: null as boolean | null, // يتحدث بعد اختبار الاسترجاع
  };
  writeFileSync(path.join(outDir, "latest-status.json"), JSON.stringify(status, null, 2), { mode: 0o600 });

  console.log(`\n✅ النسخة اتعملت: ${file}`);
  console.log(`   الحجم: ${(size / 1024).toFixed(1)} KB | الصفوف: ${status.totalRows} | sha256: ${sha.slice(0, 16)}…`);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`   أكبر الجداول: ${top.map(([t, n]) => `${t}=${n}`).join(" | ")}`);
}

main().catch((e) => {
  console.error("❌ فشل النسخ الاحتياطي:", e.message);
  process.exit(1);
});
