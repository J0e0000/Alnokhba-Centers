#!/usr/bin/env python3
# run_owner_audit.py — تنفيذ owner_sql_audit.sql (قراءة-فقط 100%) على قاعدة الإنتاج مباشرة
# بيانات الاعتماد من scripts/.dbref/.dbhost/.dbpass (مش بتتطبع) — النتيجة JSON تتحفظ في download/
import json, os, sys, time
import psycopg2

SC = "/home/z/my-project/scripts"
SQL_FILE = os.path.join(SC, "owner_sql_audit.sql")
REF = open(os.path.join(SC, ".dbref")).read().strip()
HOST = open(os.path.join(SC, ".dbhost")).read().strip()
PASS = open(os.path.join(SC, ".dbpass")).read().strip()
OUT_JSON = f"/home/z/my-project/download/db_scale_audit_{time.strftime('%Y%m%d_%H%M')}.json"

sql = open(SQL_FILE).read()
print(f"اتصال بـ {HOST}:6543 (ref={REF}) — قراءة فقط")
conn = psycopg2.connect(host=HOST, port=6543, user=f"postgres.{REF}",
                        password=PASS, dbname="postgres",
                        sslmode="require", connect_timeout=15)
cur = conn.cursor()
t0 = time.time()
cur.execute(sql)          # multi-statement في transaction واحدة — آمن على pgbouncer
row = cur.fetchone()
conn.commit()
cur.close(); conn.close()
data = row[0] if row else {}
dt = time.time() - t0
print(f"التدقيق خلص في {dt:.1f}s — الأقسام: {len(data)}")

os.makedirs("/home/z/my-project/download", exist_ok=True)
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2, default=str)
print(f"اتحفظ: {OUT_JSON}")

# ===== ملخص مختصر =====
err_keys = [k for k in data if k.endswith("_error")]
if err_keys:
    print(f"\n⚠ أقسام فشلت (تجاوزت بأمان): {err_keys}: " + ", ".join(f"{k}={data[k]}" for k in err_keys))

ov = data.get("overview") or {}
print("\n== نظرة عامة:")
for k in ("pg_version", "db_size_pretty", "user_tables", "user_indexes", "active_connections", "total_connections"):
    if k in ov: print(f"  {k}: {ov[k]}")

tt = data.get("top_tables_by_size") or []
print(f"\n== أكبر 5 جداول ({len(tt)} إجمالي):")
for t in tt[:5]:
    print(f"  {t['table']}: {t['size']} | rows≈{t['rows_est']} | seq_scan={t['seq_scan']} idx_scan={t['idx_scan']}")

di = data.get("low_use_indexes") or []
print(f"\n== فهارس ضعيفة/ميتة (>512KB وscan<10): {len(di)}")
for i in di[:8]:
    print(f"  {i['index']} على {i['table']} — {i['size']} — scans={i['idx_scan']}")

fk = data.get("fks_without_index") or []
print(f"\n== FKs من غير فهرس (بطء joins/hits): {len(fk)}")
for f_ in fk[:10]:
    print(f"  {f_['table']} ({f_['fk_cols']}) — قيد {f_['constraint']}")

ch = data.get("cache_hit") or {}
print(f"\n== cache hit: {ch.get('hit_ratio_pct', ch)}% (hits={ch.get('heap_hit')} reads={ch.get('heap_read')})")

bl = data.get("dead_tuples_top") or []
print(f"\n== dead tuples >1000 (أعلى): {len(bl)}")
for b in bl[:5]:
    print(f"  {b['table']}: dead={b['n_dead_tup']} live={b['n_live_tup']} ({b['dead_pct']}%)")

sl = data.get("slowest_statements") or []
print(f"\n== أبطأ استعلامات (pg_stat_statements): {len(sl)}")
for q in sl[:6]:
    txt = (q.get("query_120ch") or "")[:80].replace("\n", " ")
    print(f"  {q.get('mean_ms')}ms متوسط ×{q.get('calls')} — {txt}")

pol = data.get("rls_policies") or []
flags = data.get("rls_table_flags") or []
n_rls = len({f["table"] for f in flags if f.get("rls_enabled")})
n_all = len(flags)
print(f"\n== RLS: {len(pol)} policies على {len({p['table'] for p in pol})} جدول | جداول RLS مفعّل: {n_rls}/{n_all}")
no_rls = [f["table"] for f in flags if not f.get("rls_enabled")]
print(f"  جداول من غير RLS ({len(no_rls)}): {no_rls[:15]}{' ...' if len(no_rls) > 15 else ''}")

gr = data.get("grants_to_client_roles") or []
print(f"\n== صلاحيات anon/authenticated/public: {len(gr)}")
for g in gr[:8]:
    print(f"  {g['table']}: {g['grantee']} → {g['privilege']}")
