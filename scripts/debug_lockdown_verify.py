#!/usr/bin/env python3
# debug_lockdown_verify.py — فحص التحقق بعد القفل + تشخيص لماذا hp رجع عمود واحد
import json, os, datetime
import psycopg2

REF  = "ttydfyqwzkwivucgiegy"
HOST = "aws-0-eu-west-2.pooler.supabase.com"
PORT = 6543
pw = open("/home/z/my-project/scripts/.dbpass").read().strip() if os.path.exists("/home/z/my-project/scripts/.dbpass") else json.load(open("/home/z/my-project/scripts/.dbpass_candidates.json"))[1]

conn = psycopg2.connect(host=HOST, port=PORT, user=f"postgres.{REF}", password=pw,
                        dbname="postgres", sslmode="require", connect_timeout=15)
conn.autocommit = True
cur = conn.cursor()

def q(sql):
    cur.execute(sql)
    return cur.fetchall()

print("residuals:",
      q("select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated')")[0][0],
      q("select count(*) from information_schema.role_column_grants where grantee in ('anon','authenticated')")[0][0],
      q("select count(*) from information_schema.role_routine_grants where grantee in ('anon','authenticated')")[0][0],
      q("select count(*) from information_schema.usage_privileges where grantee in ('anon','authenticated') and object_type='SCHEMA'")[0][0])

# جداول User/Attendance موجودة فعلًا بأي أسماء؟
print("user-ish tables:", q("select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%user%' or table_name ilike '%attendance%') limit 10"))

for t in ("User", "Attendance"):
    exists = q(f"select to_regclass('public.\"{t}\"')")[0][0]
    print(f"to_regclass public.\"{t}\": {exists}")

for role in ("anon", "authenticated"):
    r1 = q(f"select has_table_privilege('{role}','public.\"User\"','SELECT')")
    print(f"{role} hp1={r1}")
    r2 = q(f"select has_table_privilege('{role}','public.\"Attendance\"','INSERT')")
    print(f"{role} hp2={r2}")
    r3 = q(f"select has_schema_privilege('{role}','public','USAGE')")
    print(f"{role} hp3={r3}")
    r4 = q(f"select count(*) from information_schema.role_table_grants where grantee='{role}'")
    print(f"{role} remaining table grants={r4[0][0]}")

print("app sanity User rows:", q('select count(*) from public."User"')[0][0])
conn.close()
print("DEBUG DONE")
