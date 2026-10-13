/* ============================================================
   prod_db_scale_audit.ts — تدقيق توسّع قاعدة بيانات الإنتاج (للقراءة فقط 100%)
   PHASE 4 من مهمة الأداء: أحجام الجداول والفهارس، الفهارس الميتة،
   الـ sequential scans، نسبة الكاش، الـ bloat، الاتصالات، وأبطأ الاستعلامات.

   الاستخدام:
     1) حط رابط الاتصال في scripts/.env.prod-url بالشكل:
          DATABASE_URL_POOLED="postgresql://...pooler.supabase.com:6543/postgres"
        (أو مرّره كمتغير بيئة DATABASE_URL_AUDIT مباشرة)
     2) npx tsx scripts/prod_db_scale_audit.ts

   آمن تمامًا: كل الاستعلامات SELECT على pg_stat_* / pg_catalog —
   صفر كتابة، صفر DDL، صفر لمس لبيانات المستخدمين. الأرقام بتتطبع aggregate فقط.
============================================================ */

import { readFileSync } from "fs";
import path from "path";
import pg from "pg";

function loadAuditUrl(): string {
  if (process.env.DATABASE_URL_AUDIT) return process.env.DATABASE_URL_AUDIT;
  try {
    const raw = readFileSync(path.join(process.cwd(), "scripts", ".env.prod-url"), "utf8");
    const m = raw.match(/DATABASE_URL_POOLED="(postgres[^"]+)"/);
    if (m) return m[1];
  } catch { /* الملف مش موجود */ }
  throw new Error("لا يوجد رابط تدقيق — أنشئ scripts/.env.prod-url أو مرّر DATABASE_URL_AUDIT");
}

async function main() {
  const url = loadAuditUrl();
  // إخفاء كلمة السر من أي طباعة
  const safeUrl = url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
  console.log(`🔗 Target: ${safeUrl}`);

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const q = async (title: string, sql: string, fmt?: (rows: any[]) => void) => {
    console.log(`\n── ${title}`);
    try {
      const { rows } = await client.query(sql);
      if (fmt) fmt(rows);
      else console.table(rows);
    } catch (e: any) {
      console.log(`   ⚠️ غير متاح: ${e.message?.slice(0, 140)}`);
    }
  };

  // 1) نظرة عامة على الإصدار والحجم الكلي
  await q("إصدار PostgreSQL", "SELECT version() AS v", (rows) =>
    console.log("  ", rows[0].v.split(",")[0]));

  await q("الحجم الكلي للقاعدة", `
    SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
           (SELECT count(*) FROM pg_stat_user_tables) AS tables,
           (SELECT count(*) FROM pg_stat_user_indexes) AS indexes`);

  // 2) أكبر الجداول (heap + indexes + toast)
  await q("أكبر 20 جدول (الحجم الكلي مع الفهارس)", `
    SELECT relname AS table,
           pg_size_pretty(pg_total_relation_size(relid)) AS total,
           pg_size_pretty(pg_relation_size(relid)) AS heap,
           pg_size_pretty(pg_indexes_size(relid)) AS indexes,
           n_live_tup AS rows_est,
           n_dead_tup AS dead_rows
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC LIMIT 20`);

  // 3) الفهارس الميتة — مرشّحة للحذف بعد مراجعة الـ write load
  await q("فهارس غير مستخدمة (idx_scan=0) أكبر من 512KB — مرشحة للحذف بموافقة", `
    SELECT s.relname AS table, s.indexrelname AS index,
           pg_size_pretty(pg_relation_size(s.indexrelid)) AS size,
           s.idx_scan AS scans
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.idx_scan = 0 AND pg_relation_size(s.indexrelid) > 512*1024
      AND NOT i.indisunique AND NOT i.indisprimary
    ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 20`);

  // 4) الجداول اللي بتتعمل عليها sequential scans كتير (مرشحة لفهارس)
  await q("أعلى sequential scans مقابل index scans", `
    SELECT relname AS table,
           seq_scan, seq_tup_read, idx_scan,
           CASE WHEN seq_scan > 0 THEN round(seq_tup_read::numeric/seq_scan) END AS avg_rows_per_seqscan
    FROM pg_stat_user_tables
    WHERE seq_scan > 100
    ORDER BY seq_tup_read DESC LIMIT 15`);

  // 5) نسبة cache hit — المفروض > 99% على جداول ساخنة
  await q("نسبة cache hit", `
    SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) AS cache_hit_pct,
           sum(blks_read) AS disk_reads
    FROM pg_stat_database WHERE datname = current_database()`);

  // 6) Bloat تقديري (dead tuples تحتاج VACUUM/autovacuum tuning)
  await q("أعلى dead tuples (bloat محتمل)", `
    SELECT relname AS table, n_dead_tup, n_live_tup,
           round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS dead_pct,
           last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000
    ORDER BY n_dead_tup DESC LIMIT 10`);

  // 7) الاتصالات
  await q("الاتصالات الحالية مقابل الحد", `
    SELECT count(*) AS current_connections,
           (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max_connections,
           (SELECT count(*) FROM pg_stat_activity WHERE state='idle' AND now()-state_change > interval '5 minutes') AS idle_over_5min
    FROM pg_stat_activity`);

  // 8) أبطأ الاستعلامات (لو pg_stat_statements متاح)
  await q("أبطأ الاستعلامات (pg_stat_statements) — أعلى متوسط زمن", `
    SELECT round(mean_exec_time::numeric, 1) AS avg_ms,
           calls, round(total_exec_time::numeric/1000, 1) AS total_s,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 110) AS query
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
    ORDER BY mean_exec_time DESC LIMIT 12`);

  await q("أثقل الاستعلامات إجمالي (total time)", `
    SELECT round(total_exec_time::numeric/1000, 1) AS total_s,
           calls, round(mean_exec_time::numeric, 1) AS avg_ms,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 110) AS query
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
    ORDER BY total_exec_time DESC LIMIT 12`);

  // 9) استعلامات طويلة شغالة الآن
  await q("استعلامات شغالة > 60 ثانية الآن", `
    SELECT pid, state, now()-query_start AS running_for,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 100) AS query
    FROM pg_stat_activity
    WHERE state <> 'idle' AND now()-query_start > interval '60 seconds'
      AND query NOT LIKE '%pg_stat_activity%'
    ORDER BY query_start LIMIT 10`);

  // 10) التوصية الجاهزة: أعمدة FK بلا فهارس (أشهر سبب بطء joins)
  await q("أعمدة FK بلا فهارس (مرشحة لـ CREATE INDEX CONCURRENTLY)", `
    SELECT c.conrelid::regclass AS table_with_fk,
           string_agg(a.attname, ', ' ORDER BY a.attname) AS unindexed_fk_columns
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (i.indkey::int2[] && c.conkey::int2[])
          AND i.indpred IS NULL)
    GROUP BY c.conrelid LIMIT 20`);

  await client.end();
  console.log("\n✅ التدقيق خلص — النتيجة دي baseline قبل أي تحسين. احفظها للمقارنة.");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
