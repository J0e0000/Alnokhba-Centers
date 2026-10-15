#!/usr/bin/env python3
# audit_followup.py — إكمال القسمين اللي اخطأوا في السكربت الأصلي (bug في السكربت مش في القاعدة):
# 1) low-use indexes (كان فيه i.relname على pg_index — الصح indrelid::regclass)
# 2) cache hit عبر pg_stat_database (pg_statio_user_database مش متاحة عبر المسار ده)
# قراءة فقط. النتائج تتدمج في نفس ملف الـ JSON.
import json, os, time
import psycopg2

SC = "/home/z/my-project/scripts"
REF = open(os.path.join(SC, ".dbref")).read().strip()
HOST = open(os.path.join(SC, ".dbhost")).read().strip()
PASS = open(os.path.join(SC, ".dbpass")).read().strip()

import glob
files = sorted(glob.glob("/home/z/my-project/download/db_scale_audit_*.json"))
OUT = files[-1]
data = json.load(open(OUT))

SQL1 = """
SELECT i.indexrelid::regclass::text AS idx, i.indrelid::regclass::text AS tbl,
       pg_relation_size(i.indexrelid) AS bytes, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
       st.idx_scan
FROM pg_stat_user_indexes st
JOIN pg_index i ON i.indexrelid = st.indexrelid
WHERE st.idx_scan < 10 AND pg_relation_size(i.indexrelid) > 512*1024
ORDER BY pg_relation_size(i.indexrelid) DESC
"""
SQL2 = """
SELECT round(100.0*blks_hit/nullif(blks_hit+blks_read,0),2) AS hit_pct,
       blks_hit, blks_read
FROM pg_stat_database WHERE datname = current_database()
"""

conn = psycopg2.connect(host=HOST, port=6543, user=f"postgres.{REF}",
                        password=PASS, dbname="postgres", sslmode="require", connect_timeout=15)
cur = conn.cursor()
cur.execute(SQL1)
rows = cur.fetchall()
data["low_use_indexes"] = [
    {"index": r[0], "table": r[1], "bytes": r[2], "size": r[3], "idx_scan": r[4]} for r in rows
]
data.pop("low_use_indexes_error", None)

cur.execute(SQL2)
r = cur.fetchone()
data["cache_hit"] = {"hit_ratio_pct": r[0], "heap_hit": r[1], "heap_read": r[2]}
data.pop("cache_hit_error", None)

conn.commit(); cur.close(); conn.close()
json.dump(data, open(OUT, "w"), ensure_ascii=False, indent=2, default=str)
print(f"اتدمج في {OUT}")
print(f"\n== فهارس ضعيفة/ميتة (>512KB, scans<10): {len(rows)}")
for r_ in rows[:10]:
    print(f"  {r_[0]} على {r_[1]} — {r_[3]} — scans={r_[4]}")
print(f"\n== cache hit ratio: {r[0]}% (hits={r[1]}, reads={r[2]})")
