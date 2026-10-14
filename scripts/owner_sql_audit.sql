-- ============================================================
-- ALNOKHBA — DB Scale Audit + RLS Review (قراءة فقط 100%)
-- تشغيل: الصق السكربت كامل في Supabase SQL Editor → Run
-- النتيجة: خلية JSON واحدة في آخر SELECT — انسخها وابعتها في الشات.
-- آمن تمامًا: SELECT/كاتالوج فقط — صفر كتابة، صفر تعديل،
-- مفيش صفوف بيانات مستخدمين (إحصائيات aggregate + تعريفات policies فقط).
-- ============================================================
DROP ROLE IF EXISTS audit_ro;   -- تنظيف محاولة الـ role السابقة لو اتعملت
DROP TABLE IF EXISTS _nk_audit;
CREATE TEMP TABLE _nk_audit (r jsonb);

DO $audit$
DECLARE
  j jsonb := '{}'::jsonb;
  s jsonb;
BEGIN
  ---------------------------------------------------------- 1) نظرة عامة
  BEGIN
    s := (SELECT jsonb_build_object(
            'generated_at', now(),
            'pg_version', split_part(version(), ', ', 1),
            'db_size_bytes', pg_database_size(current_database()),
            'db_size_pretty', pg_size_pretty(pg_database_size(current_database())),
            'user_tables', (SELECT count(*) FROM pg_stat_user_tables),
            'user_indexes', (SELECT count(*) FROM pg_stat_user_indexes),
            'active_connections', (SELECT count(*) FROM pg_stat_activity WHERE state <> 'idle'),
            'total_connections', (SELECT count(*) FROM pg_stat_activity)));
    j := j || jsonb_build_object('overview', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('overview_error', sqlerrm);
  END;

  ---------------------------------------------------------- 2) أكبر 15 جدول
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x.total_bytes DESC), '[]'::jsonb)
          FROM (SELECT c.relname AS "table",
                       pg_total_relation_size(c.oid) AS total_bytes,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS "size",
                       st.n_live_tup AS "rows_est",
                       st.seq_scan, st.seq_tup_read, st.idx_scan
                FROM pg_stat_user_tables st
                JOIN pg_class c ON c.oid = st.relid
                ORDER BY pg_total_relation_size(c.oid) DESC
                LIMIT 15) x);
    j := j || jsonb_build_object('top_tables_by_size', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('top_tables_error', sqlerrm);
  END;

  ---------------------------------------------------------- 3) فهارس ضعيفة/ميتة
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x.bytes DESC), '[]'::jsonb)
          FROM (SELECT i.indexrelid::regclass::text AS "index",
                       i.relname AS "table",
                       pg_relation_size(i.indexrelid) AS bytes,
                       pg_size_pretty(pg_relation_size(i.indexrelid)) AS "size",
                       st.idx_scan
                FROM pg_stat_user_indexes st
                JOIN pg_index i ON i.indexrelid = st.indexrelid
                WHERE st.idx_scan < 10
                  AND pg_relation_size(i.indexrelid) > 512*1024
                  AND NOT i.indisunique AND NOT i.indisprimary
                ORDER BY pg_relation_size(i.indexrelid) DESC
                LIMIT 20) x);
    j := j || jsonb_build_object('low_use_indexes', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('low_use_indexes_error', sqlerrm);
  END;

  ---------------------------------------------------------- 4) مفاتيح أجنبية من غير فهرس
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x."table", x."constraint"), '[]'::jsonb)
          FROM (SELECT con.conname AS "constraint",
                       con.conrelid::regclass::text AS "table",
                       (SELECT string_agg(a.attname, ',' ORDER BY ox.ord)
                        FROM unnest(con.conkey) WITH ORDINALITY AS ox(attnum, ord)
                        JOIN pg_attribute a
                          ON a.attrelid = con.conrelid AND a.attnum = ox.attnum) AS "fk_cols",
                       NOT EXISTS (
                         SELECT 1 FROM pg_index i
                         WHERE i.indrelid = con.conrelid
                           AND (i.indkey::int2[])[0:array_length(con.conkey,1)-1]
                               @> con.conkey::int2[]
                       ) AS "missing_index"
                FROM pg_constraint con
                WHERE con.contype = 'f'
                  AND con.connamespace = 'public'::regnamespace) x
          WHERE x.missing_index);
    j := j || jsonb_build_object('fks_without_index', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('fks_without_index_error', sqlerrm);
  END;

  ---------------------------------------------------------- 5) نسبة الكاش
  BEGIN
    s := (SELECT jsonb_build_object(
            'heap_hit', sum(blks_hit),
            'heap_read', sum(blks_read),
            'hit_ratio_pct', round(100.0*sum(blks_hit)
                             / nullif(sum(blks_hit)+sum(blks_read),0), 2))
          FROM pg_statio_user_database);
    j := j || jsonb_build_object('cache_hit', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('cache_hit_error', sqlerrm);
  END;

  ---------------------------------------------------------- 6) أثقل الجداول dead tuples (bloat)
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x.n_dead_tup DESC), '[]'::jsonb)
          FROM (SELECT relname AS "table", n_live_tup, n_dead_tup,
                       round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS "dead_pct",
                       last_vacuum, last_autovacuum
                FROM pg_stat_user_tables
                WHERE n_dead_tup > 1000
                ORDER BY n_dead_tup DESC
                LIMIT 10) x);
    j := j || jsonb_build_object('dead_tuples_top', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('dead_tuples_error', sqlerrm);
  END;

  ---------------------------------------------------------- 7) الاتصالات الحالية
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x.cnt DESC), '[]'::jsonb)
          FROM (SELECT usename, application_name, state, count(*) AS cnt
                FROM pg_stat_activity
                GROUP BY 1,2,3 ORDER BY count(*) DESC) x);
    j := j || jsonb_build_object('connections', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('connections_error', sqlerrm);
  END;

  ---------------------------------------------------------- 8) أبطأ الاستعلامات
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
          FROM (SELECT round(total_exec_time::numeric,1) AS "total_ms",
                       calls,
                       round(mean_exec_time::numeric,1) AS "mean_ms",
                       rows,
                       left(query,120) AS "query_120ch"
                FROM pg_stat_statements
                WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                ORDER BY total_exec_time DESC
                LIMIT 12) x);
    j := j || jsonb_build_object('slowest_statements', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('slowest_statements_error', sqlerrm);
  END;

  ---------------------------------------------------------- 9) كل سياسات RLS
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x."table", x.policy), '[]'::jsonb)
          FROM (SELECT tablename AS "table", policyname AS "policy", cmd,
                       roles, permissive,
                       left(coalesce(qual,''),200) AS "using_expr",
                       left(coalesce(with_check,''),200) AS "with_check"
                FROM pg_policies
                WHERE schemaname = 'public'
                ORDER BY tablename, policyname) x);
    j := j || jsonb_build_object('rls_policies', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('rls_policies_error', sqlerrm);
  END;

  ---------------------------------------------------------- 10) حالة RLS لكل جدول
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x."table"), '[]'::jsonb)
          FROM (SELECT c.relname AS "table",
                       c.relrowsecurity AS "rls_enabled",
                       c.relforcerowsecurity AS "rls_forced",
                       pg_get_userbyid(c.relowner) AS "owner",
                       c.reltuples::bigint AS "rows_est"
                FROM pg_class c
                WHERE c.relkind IN ('r','p')
                  AND c.relnamespace = 'public'::regnamespace) x);
    j := j || jsonb_build_object('rls_table_flags', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('rls_table_flags_error', sqlerrm);
  END;

  ---------------------------------------------------------- 11) من متاح لـ anon/authenticated/public
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x."table", x.grantee), '[]'::jsonb)
          FROM (SELECT c.relname AS "table",
                       pg_get_userbyid(a.grantee) AS "grantee",
                       a.privilege_type AS "privilege"
                FROM pg_class c
                JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a ON true
                WHERE c.relkind IN ('r','p')
                  AND c.relnamespace = 'public'::regnamespace
                  AND pg_get_userbyid(a.grantee) IN ('anon','authenticated','public')) x);
    j := j || jsonb_build_object('grants_to_client_roles', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('grants_to_client_roles_error', sqlerrm);
  END;

  ---------------------------------------------------------- 12) الأدوار الموجودة
  BEGIN
    s := (SELECT coalesce(jsonb_agg(x ORDER BY x."role"), '[]'::jsonb)
          FROM (SELECT rolname AS "role", rolsuper AS "superuser",
                       rolbypassrls AS "bypass_rls", rolcanlogin AS "can_login",
                       rolcreaterole AS "create_role", rolcreatedb AS "create_db",
                       rolvaliduntil AS "password_expires"
                FROM pg_roles
                WHERE rolcanlogin
                   OR rolname IN ('anon','authenticated','service_role','authenticator')) x);
    j := j || jsonb_build_object('roles', s);
  EXCEPTION WHEN OTHERS THEN
    j := j || jsonb_build_object('roles_error', sqlerrm);
  END;

  INSERT INTO _nk_audit VALUES (j);
END
$audit$;

SELECT r FROM _nk_audit;
