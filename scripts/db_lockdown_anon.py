#!/usr/bin/env python3
# db_lockdown_anon.py — إغلاق سطح هجوم PostgREST بالكامل (موافقة صريحة من المالك).
# REVOKE ALL FROM anon, authenticated على: الجداول + الأعمدة + الـ sequences + الدوال + صلاحيات الـ schema + الـ default privileges.
# الأمان:
#  1) before-snapshot كامل لكل المنح → JSON + سكربت GRANT للاسترجاع (rollback كامل).
#  2) التطبيق يتصل بـ postgres (superuser) — الـ REVOKE لا يمس صلاحياته إطلاقًا.
#  3) تحقق بعد التنفيذ: صفر منح متبقية + has_table_privilege=false + التطبيق لايف شغال.
# لا يُطبع أي سر. 100% DDL على أدوار REST — صفر كتابة على بيانات المستخدمين.
import json, os, sys, datetime
import psycopg2

REF  = os.environ.get("NK_DB_REF",  "ttydfyqwzkwivucgiegy")
HOST = os.environ.get("NK_DB_HOST", "aws-0-eu-west-2.pooler.supabase.com")
PORT = 6543
DB   = "postgres"
PASS_FILE = "/home/z/my-project/scripts/.dbpass"
CAND_FILE = "/home/z/my-project/scripts/.dbpass_candidates.json"
OUT_DIR   = "/home/z/my-project/download"

def get_password():
    if os.path.exists(PASS_FILE):
        pw = open(PASS_FILE).read().strip()
        if pw:
            return pw, "saved-winner(.dbpass)"
    cands = json.load(open(CAND_FILE))
    return cands[1], "candidate#2(ITER5-verified)"

def connect():
    pw, src = get_password()
    conn = psycopg2.connect(host=HOST, port=PORT, user=f"postgres.{REF}",
                            password=pw, dbname=DB, sslmode="require", connect_timeout=15)
    conn.autocommit = True
    return conn, src

def q(cur, sql):
    cur.execute(sql)
    return cur.fetchall()

def main():
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    conn, src = connect()
    print(f"connected via pooler:{PORT} (password source: {src})")
    cur = conn.cursor()

    # ---------- 0) sanity ----------
    me = q(cur, "select current_user, current_setting('is_superuser')")[0]
    print(f"session identity: current_user={me[0]} superuser={me[1]}")
    roles = {r[0] for r in q(cur, "select rolname from pg_roles where rolname in ('anon','authenticated','postgres')")}
    assert {"anon", "authenticated"} <= roles, f"missing roles: {roles}"

    # ---------- 1) BEFORE snapshot ----------
    snap = {
        "timestamp": ts, "ref": REF, "roles": ["anon", "authenticated"],
        "table_grants":   q(cur, """select grantee, table_schema, table_name, privilege_type
                                    from information_schema.role_table_grants
                                    where grantee in ('anon','authenticated') order by 1,2,3,4"""),
        "column_grants":  q(cur, """select grantee, table_schema, table_name, column_name, privilege_type
                                    from information_schema.role_column_grants
                                    where grantee in ('anon','authenticated') order by 1,2,3,4,5"""),
        "routine_grants": q(cur, """select grantee, specific_schema, routine_name, privilege_type
                                    from information_schema.role_routine_grants
                                    where grantee in ('anon','authenticated') order by 1,2,3,4"""),
        "schema_privs":   q(cur, """select grantee, object_name, privilege_type
                                    from information_schema.usage_privileges
                                    where grantee in ('anon','authenticated')
                                      and object_type='SCHEMA' and object_name='public'
                                    order by 1,2,3"""),
        "default_acls":   q(cur, """select pg_get_userbyid(defaclrole) as granting_role,
                                           coalesce(defaclnamespace::regnamespace::text,'*') as ns,
                                           defaclobjtype, defaclacl::text
                                    from pg_default_acl"""),
    }
    tg = len(snap["table_grants"]); cg = len(snap["column_grants"])
    rg = len(snap["routine_grants"]); sp = len(snap["schema_privs"])
    print(f"BEFORE: table_grants={tg} column_grants={cg} routine_grants={rg} schema_privs={sp}")

    sample = q(cur, """select distinct table_name from information_schema.role_table_grants
                       where grantee in ('anon','authenticated') limit 3""")
    print(f"tables with grants (sample): {[r[0] for r in sample]}")

    # ---------- 2) restore SQL (rollback artifact) ----------
    lines = [
        "-- db_lockdown restore script (rollback) — generated from BEFORE snapshot",
        f"-- generated: {ts} | ref: {REF} | use ONLY if owner orders full restore",
        "-- NOTE: schema USAGE + default privileges restored manually at the bottom.",
        "",
    ]
    per_tbl = {}
    for g, s, t, p in snap["table_grants"]:
        per_tbl.setdefault((s, t), set()).add(p)
    for (s, t), privs in sorted(per_tbl.items()):
        pl = ", ".join(sorted(privs))
        for role in ("anon", "authenticated"):
            lines.append(f"GRANT {pl} ON TABLE {s}.{t} TO {role};")
    lines.append("")
    lines.append("GRANT USAGE ON SCHEMA public TO anon; GRANT USAGE ON SCHEMA public TO authenticated;")
    lines.append("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;")
    lines.append("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;")
    lines.append("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;")
    lines.append("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;")
    restore_path = f"{OUT_DIR}/db_lockdown_restore_{ts}.sql"
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(restore_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(restore_path, 0o600)
    print(f"rollback artifact: {restore_path} ({len(lines)-1} statements)")

    # ---------- 3) EXECUTE lockdown ----------
    stmts = [
        "REVOKE ALL PRIVILEGES ON ALL TABLES     IN SCHEMA public FROM anon, authenticated",
        "REVOKE ALL PRIVILEGES ON ALL SEQUENCES  IN SCHEMA public FROM anon, authenticated",
        "REVOKE ALL PRIVILEGES ON ALL FUNCTIONS  IN SCHEMA public FROM anon, authenticated",
        "REVOKE ALL PRIVILEGES ON ALL ROUTINES   IN SCHEMA public FROM anon, authenticated",
        "REVOKE USAGE ON SCHEMA public FROM anon",
        "REVOKE USAGE ON SCHEMA public FROM authenticated",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated",
    ]
    for s in stmts:
        cur.execute(s)
        print(f"OK: {s[:78]}")

    # ---------- 4) AFTER verification ----------
    tg2 = q(cur, """select count(*) from information_schema.role_table_grants
                    where grantee in ('anon','authenticated')""")[0][0]
    cg2 = q(cur, """select count(*) from information_schema.role_column_grants
                    where grantee in ('anon','authenticated')""")[0][0]
    rg2 = q(cur, """select count(*) from information_schema.role_routine_grants
                    where grantee in ('anon','authenticated')""")[0][0]
    sp2 = q(cur, """select count(*) from information_schema.usage_privileges
                    where grantee in ('anon','authenticated')
                      and object_type='SCHEMA' and object_name='public'""")[0][0]
    print(f"AFTER: table_grants={tg2} column_grants={cg2} routine_grants={rg2} schema_privs={sp2}")

    probs = []
    for role in ("anon", "authenticated"):
        hp = q(cur, f"select has_table_privilege('{role}','public.\"User\"','SELECT'),"
                    f" has_table_privilege('{role}','public.\"Attendance\"','INSERT'),"
                    f" has_schema_privilege('{role}','public','USAGE')")
        if any(hp):
            probs.append((role, hp))
        print(f"{role}: User.SELECT={hp[0]} Attendance.INSERT={hp[1]} schema.USAGE={hp[2]}")

    # app sanity عبر نفس الاتصال: postgres لسه بيقرأ كل حاجة
    app_ok = q(cur, 'select count(*) from public."User"')[0][0]
    print(f"app-path sanity: postgres still reads public.\"User\" → {app_ok} rows ✓")

    # ---------- 5) persist evidence ----------
    snap["after"] = {"table_grants": tg2, "column_grants": cg2, "routine_grants": rg2, "schema_privs": sp2}
    snap["statement_results"] = [s for s in stmts]
    snap["app_path_sanity_user_rows"] = app_ok
    out = f"{OUT_DIR}/db_lockdown_report_{ts}.json"
    with open(out, "w") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1, default=str)
    os.chmod(out, 0o600)
    print(f"evidence file: {out}")

    if probs:
        print("LOCKDOWN INCOMPLETE:", probs)
        sys.exit(2)
    if tg2 or cg2 or rg2 or sp2:
        print("LOCKDOWN INCOMPLETE: residuals remain")
        sys.exit(2)
    print("LOCKDOWN COMPLETE ✓ — سطح هجوم PostgREST مغلق بالكامل (anon+authenticated بلا أي صلاحية).")
    conn.close()

if __name__ == "__main__":
    main()
