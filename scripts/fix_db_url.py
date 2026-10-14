#!/usr/bin/env python3
# fix_db_url.py — إصلاح DATABASE_URL على Vercel بعد reset باسورد Supabase
# الاستخدام:  NK_NEW_DB_PASS="الباسورد_الجديد" python3 scripts/fix_db_url.py
# ما بيعمله: يبني الرابط بالصيغة المعتمدة من docs/PRODUCTION-DB.md →
#   postgres://postgres.<ref>:<PASS>@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
# ثم: upsert للمتغير (sensitive, production) → إعادة نشر إنتاج → انتظار READY
#     → تحقق لايف (dbPing + db-status + students بجلسة manager) — بدون طباعة أي سر.
import os, sys, json, time, urllib.request, urllib.parse

TOKEN = open(os.path.join(os.path.dirname(__file__), ".vercel-token")).read().strip()
PROJECT = "prj_Z5WHaJnlKq894WWFv5tQBblWa74b"
TEAM = "team_w8PxkM7uGzBh1Dh5rbqAoHki"
BASE = f"https://api.vercel.com"
PROD = "https://alnokhba-centers-nine.vercel.app"
DB_REF = os.environ.get("NK_DB_REF") or "ttydfyqwzkwivucgiegy"   # الحقيقي من المالك (كان مقروء غلط: ttydfyqwzkiwuvcgiegy)
DB_HOST = os.environ.get("NK_DB_HOST") or "aws-0-eu-west-2.pooler.supabase.com"

PASS = os.environ.get("NK_NEW_DB_PASS")
if not PASS:
    sys.exit("ERROR: مرر الباسورد الجديد كمتغير NK_NEW_DB_PASS (مش نصي في الأمر)")
PASS_ENC = urllib.parse.quote(PASS, safe="")
NEW_URL = f"postgres://postgres.{DB_REF}:{PASS_ENC}@{DB_HOST}:6543/postgres?pgbouncer=true&connection_limit=1"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]  # الرد من الـ API مفيهوش القيمة أبدًا
        sys.exit(f"ERROR {e.code} on {method} {path}: {detail}")

def login(kind):
    data = json.dumps({"username": kind, "password": "nokhba123"}).encode()
    req = urllib.request.Request(PROD + "/api/auth", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        cookie = r.headers.get("Set-Cookie", "").split(";")[0]
        return cookie

def probe(path, cookie=None):
    req = urllib.request.Request(PROD + path)
    if cookie: req.add_header("Cookie", cookie)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())

print("== 1) تحديث DATABASE_URL (sensitive, production-only) — القيمة مش بتتطبع")
envs = api("GET", f"/v9/projects/{PROJECT}/env?teamId={TEAM}")
cur = next((e for e in envs.get("envs", []) if e.get("key") == "DATABASE_URL"), None)
if cur is None:
    api("POST", f"/v9/projects/{PROJECT}/env?teamId={TEAM}",
        {"key": "DATABASE_URL", "value": NEW_URL, "type": "sensitive",
         "target": ["production"]})
    print("   created (مش كان موجود) ✓")
else:
    api("PATCH", f"/v9/projects/{PROJECT}/env/{cur['id']}?teamId={TEAM}",
        {"value": NEW_URL, "target": ["production"]})
    print(f"   updated existing env ({cur['id']}, target={','.join(cur.get('target', []))}) ✓")

print("== 2) إعادة نشر الإنتاج (إعادة نشر آخر deployment جاهز بنفس الإعدادات)")
deps = api("GET", f"/v6/deployments?projectId={PROJECT}&teamId={TEAM}&target=production&limit=1&state=READY")
latest = deps["deployments"][0]
print(f"   base: {latest['uid']} ({latest.get('sha','')[:7]})")
new_dep = api("POST", f"/v13/deployments?teamId={TEAM}&skipAutoDetectionConfirmation=1",
    {"name": "alnokhba-centers", "deploymentId": latest["uid"], "target": "production"})
dep_id, dep_url = new_dep.get("id"), new_dep.get("url", "")
print(f"   new deployment: {dep_id} -> {dep_url}")

print("== 3) انتظار READY (حد أقصى 8 دقايق)...")
for i in range(48):
    time.sleep(10)
    d = api("GET", f"/v13/deployments/{dep_id}?teamId={TEAM}")
    st = d.get("readyState") or d.get("state")
    if st in ("READY", "ERROR", "CANCELED"):
        print(f"   state: {st} بعد {i*10}ث")
        if st != "READY": sys.exit("ERROR: النشر فشل — مفيش تغيير اتأثر على النشر القديم اللسه شغال")
        break
    if i % 3 == 0: print(f"   ... {st} ({i*10}ث)")
else:
    sys.exit("TIMEOUT: النشر أخد أكتر من 8 دقايق — افحص الداشبورد")

print("== 4) تحقق لايف على الإنتاج الجديد (بإعادة محاولة — التبديل بياخد ثواني)")
for attempt in range(4):
    try:
        a = login("manager")
        st, sysd = probe("/api/sysdiag", a)
        ping = (sysd.get("dbPing") or {}).get("avgMs")
        print(f"   sysdiag: {st} | commit: {sysd.get('commit')} | dbPing avg: {ping}ms | dbRegion: {sysd.get('dbRegion')}")
        st, dbst = probe("/api/system/db-status")
        print(f"   db-status: {st} {dbst}")
        st, studs = probe("/api/students?limit=1", a)
        print(f"   students (manager): {st} — {'بيانات رجعت ✓' if st==200 else 'FAILED ✗'}")
        if st == 200 and isinstance(ping, (int, float)) and ping < 200:
            ok = True
            break
    except Exception as e:
        print(f"   محاولة {attempt+1} فشلت ({type(e).__name__}) — إعادة بعد 8ث...")
    time.sleep(8)
ok = locals().get('ok', False)
print(f"\n== النتيجة: {'الإصلاح نجح والاتصال الجديد شغال ✓' if ok else 'محتاج مراجعة — ابعثلي المخرجات'}")
