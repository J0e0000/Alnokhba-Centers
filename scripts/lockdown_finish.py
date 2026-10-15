#!/usr/bin/env python3
# lockdown_finish.py — إغلاق البقايا في schemas أخرى + تقرير أدلة كامل + rollback للبقايا
import json, os, datetime
import psycopg2

REF, HOST, PORT = "ttydfyqwzkwivucgiegy", "aws-0-eu-west-2.pooler.supabase.com", 6543
OUT_DIR = "/home/z/my-project/download"
pw = open("/home/z/my-project/scripts/.dbpass").read().strip() if os.path.exists("/home/z/my-project/scripts/.dbpass") else json.load(open("/home/z/my-project/scripts/.dbpass_candidates.json"))[1]
ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

conn = psycopg2.connect(host=HOST, port=PORT, user=f"postgres.{REF}", password=pw,
                        dbname="postgres", sslmode="require", connect_timeout=15)
conn.autocommit = True
cur = conn.cursor()
def q(sql):
    cur.execute(sql); return cur.fetchall()

# 1) أين البقايا بالضبط؟ (بكل الـ schemas)
resid_tables  = q("""select grantee, table_schema, table_name, string_agg(privilege_type,',' order by privilege_type)
                     from information_schema.role_table_grants
                     where grantee in ('anon','authenticated')
                     group by 1,2,3 order by 2,3,1""")
resid_routines= q("""select grantee, specific_schema, routine_name, string_agg(privilege_type,',' order by privilege_type)
                     from information_schema.role_routine_grants
                     where grantee in ('anon','authenticated')
                     group by 1,2,3 order by 2,3,1""")
resid_cols    = q("""select distinct table_schema, table_name from information_schema.role_column_grants
                     where grantee in ('anon','authenticated') order by 1,2""")
schemas_hit   = sorted({r[1] for r in resid_tables} | {r[1] for r in resid_routines})
print(f"residual schemas: {schemas_hit}")
print(f"residual tables: {len(resid_tables)} | routines: {len(resid_routines)} | col-tables: {len(resid_cols)}")
for r in resid_tables[:12]:
    print("  tbl:", r)

# 2) default privileges — من بيمنح تلقائيًا لـ anon/authenticated الآن؟
dacl = q("""select pg_get_userbyid(defaclrole) as grantor, coalesce(defaclnamespace::regnamespace::text,'*') as ns,
                   defaclobjtype, defaclacl::text from pg_default_acl""")
for d in dacl:
    if 'anon' in d[3] or 'authenticated' in d[3]:
        print("DEFAULT-ACL STILL GRANTING:", d)

# 3) rollback artifact للبقايا
lines = ["-- restore for residual (non-public) grants snapshot BEFORE extension REVOKE", f"-- ts={ts}"]
for g, s, t, p in resid_tables:
    lines.append(f"GRANT {p} ON TABLE {s}.{t} TO {g};")
for g, s, r, p in resid_routines:
    lines.append(f"GRANT {p} ON FUNCTION {s}.{r} TO {g};")
for s, t in resid_cols:
    lines.append(f"-- column grants existed on {s}.{t} (see report json)")
res_path = f"{OUT_DIR}/db_lockdown_residuals_restore_{ts}.sql"
with open(res_path, "w") as f: f.write("\n".join(lines) + "\n")
os.chmod(res_path, 0o600)

# 4) تمديد القفل على كل schema فيها بقايا (نفس نطاق الموافقة: anon + authenticated)
executed = []
for s in schemas_hit:
    for st in (f"REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA {s} FROM anon, authenticated",
               f"REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA {s} FROM anon, authenticated",
               f"REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA {s} FROM anon, authenticated",
               f"REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA {s} FROM anon, authenticated"):
        cur.execute(st); executed.append(st)
# صلاحيات USAGE على schemas أخرى (غير public) لو كانت منحة صريحة
for r in q("""select distinct grantee, object_name from information_schema.usage_privileges
              where grantee in ('anon','authenticated') and object_type='SCHEMA'"""):
    st = f"REVOKE ALL ON SCHEMA {r[1]} FROM {r[0]}"
    cur.execute(st); executed.append(st)
print(f"extension REVOKEs executed: {len(executed)}")

# 5) تحقق نهائي صارم
after_t = q("select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated')")[0][0]
after_c = q("select count(*) from information_schema.role_column_grants where grantee in ('anon','authenticated')")[0][0]
after_r = q("select count(*) from information_schema.role_routine_grants where grantee in ('anon','authenticated')")[0][0]
after_s = q("select count(*) from information_schema.usage_privileges where grantee in ('anon','authenticated') and object_type='SCHEMA'")[0][0]
print(f"AFTER-ALL: tables={after_t} cols={after_c} routines={after_r} schema_usage={after_s}")

checks = {}
for role in ("anon", "authenticated"):
    row = q(f"""select has_table_privilege('{role}','public."User"','SELECT'),
                       has_table_privilege('{role}','public."Attendance"','INSERT'),
                       has_table_privilege('{role}','public."Student"','UPDATE'),
                       has_schema_privilege('{role}','public','USAGE')""")[0]
    checks[role] = {"User.SELECT": row[0], "Attendance.INSERT": row[1], "Student.UPDATE": row[2], "schema.USAGE": row[3]}
    print(role, checks[role])

app_rows = q('select count(*) from public."User"')[0][0]
app_att  = q('select count(*) from public."Attendance"')[0][0]
print(f"app-path sanity: postgres reads User={app_rows} rows, Attendance={app_att} rows ✓")

# 6) تقرير الأدلة النهائي
report = {
    "timestamp": ts, "ref": REF, "scope": "REVOKE ALL FROM anon, authenticated (owner-approved)",
    "phase1_residual_check": {"schemas_hit": schemas_hit, "tables": resid_tables, "routines": resid_routines},
    "default_acls_current": dacl,
    "extension_statements": executed,
    "after": {"table_grants": after_t, "column_grants": after_c, "routine_grants": after_r, "schema_usage_grants": after_s},
    "privilege_checks": checks,
    "app_path_sanity": {"User_rows": app_rows, "Attendance_rows": app_att},
    "restore_files": ["db_lockdown_restore_20261015_*.sql (phase-1, exists from first run)", f"db_lockdown_residuals_restore_{ts}.sql"],
    "note_public_usage": "has_schema_privilege(USAGE on public) may stay True via PUBLIC membership — harmless with ZERO table grants; optional dashboard kill-switch: disable Data API",
}
out = f"{OUT_DIR}/db_lockdown_report_{ts}.json"
with open(out, "w") as f: json.dump(report, f, ensure_ascii=False, indent=1, default=str)
os.chmod(out, 0o600)
print("report:", out)
print("restore:", res_path)
ok = (after_t == 0 and after_c == 0 and after_r == 0 and after_s == 0
      and not any(checks[r][k] for r in checks for k in ("User.SELECT", "Attendance.INSERT", "Student.UPDATE")))
print("LOCKDOWN COMPLETE ✓" if ok else "STILL INCOMPLETE ✗")
conn.close()
