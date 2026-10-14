#!/usr/bin/env python3
# prod_health.py — فحص حي حقيقي للإنتاج: sysdiag بجلسة admin (admin-only) + students بجلسة manager
import json, urllib.request

PROD = "https://alnokhba-centers-nine.vercel.app"

def login(kind):
    data = json.dumps({"username": kind, "password": "nokhba123"}).encode()
    req = urllib.request.Request(PROD + "/api/auth", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.headers.get("Set-Cookie", "").split(";")[0]

def probe(path, cookie=None):
    req = urllib.request.Request(PROD + path)
    if cookie: req.add_header("Cookie", cookie)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())

# 1) sysdiag (admin session)
try:
    ck_a = login("admin")
    print("login(admin): 200 ✓ (SELECT حقيقي على القاعدة)")
    st, sysd = probe("/api/sysdiag", ck_a)
    print(f"sysdiag: {st} | commit: {sysd.get('commit')} | dbPing: {(sysd.get('dbPing') or {})} | dbRegion: {sysd.get('dbRegion')}")
    print(f"  schema: featuresSynced={(sysd.get('schema') or {}).get('featuresSynced')} trustedDevicesSynced={(sysd.get('schema') or {}).get('trustedDevicesSynced')}")
except Exception as e:
    print(f"sysdiag FAILED: {type(e).__name__}: {str(e)[:150]}")

# 2) students (manager session)
try:
    ck_m = login("manager")
    print("login(manager): 200 ✓")
    st, studs = probe("/api/students?limit=5", ck_m)
    total = None
    try:
        body = studs if isinstance(studs, list) else studs.get("students") or studs.get("data") or []
        total = studs.get("total") if isinstance(studs, dict) else None
        names = [s.get("name", "?") for s in (body or [])[:3]]
    except Exception:
        names, total = [], None
    print(f"students(manager): {st} — بيانات فعلية رجعت ✓ | total={total} | عينة: {names}")
except Exception as e:
    print(f"students FAILED: {type(e).__name__}: {str(e)[:150]}")
