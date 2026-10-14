#!/usr/bin/env python3
# prod_health.py — فحص حي حقيقي للإنتاج: login (بيضرب جدول users) + sysdiag (dbPing حقيقي) + students
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

try:
    ck = login("manager")
    print("login(manager): 200 — دي عملية SELECT حقيقية على قاعدة الإنتاج ✓")
    st, sysd = probe("/api/sysdiag", ck)
    print(f"sysdiag: {st} | commit: {sysd.get('commit')} | dbPing: {(sysd.get('dbPing') or {}).get('avgMs')}ms | dbRegion: {sysd.get('dbRegion')}")
    st, studs = probe("/api/students?limit=1", ck)
    print(f"students(manager): {st} {'✓ بيانات فعلية رجعت' if st == 200 else '✗'}")
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {str(e)[:200]}")
