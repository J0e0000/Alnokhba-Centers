#!/usr/bin/env python3
# find_db_ref.py — إيجاد ref قاعدة الإنتاج الحقيقية من Vercel Storage/Integrations APIs.
# يطبع metadata فقط + host/username من أي connection string (الباسورد يُقنَّع دائمًا).
import json, os, re, sys, urllib.request, urllib.parse

TOKEN = open("/home/z/my-project/scripts/.vercel-token").read().strip()
TEAM = "team_w8PxkM7uGzBh1Dh5rbqAoHki"
BASE = "https://api.vercel.com"

def api(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"__err": e.code, "__body": e.read().decode()[:200]}
    except Exception as e:
        return {"__err": str(e)[:120]}

def mask_url(u):
    # يطبع scheme + user + host + path فقط — كلمة المرور تُقنّع
    m = re.match(r"([a-z0-9+]+)://([^:@/]+):([^@]+)@([^/]+)(/[^?]*)?(\?.*)?", u)
    if not m:
        return u[:40]
    return f"{m.group(1)}://{m.group(2)}:***@{m.group(4)}{m.group(5) or ''}"

def scan_obj(o, path=""):
    # يبحث عن أي strings شكلها connection string ويطبعها مقنعة
    hits = []
    def rec(x, p):
        if isinstance(x, dict):
            for k, v in x.items(): rec(v, f"{p}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x): rec(v, f"{p}[{i}]")
        elif isinstance(x, str) and re.match(r"postgre?s?://", x):
            hits.append((p, mask_url(x)))
        elif isinstance(x, str) and (".pooler.supabase.com" in x or ".supabase.co" in x) and len(x) < 120:
            hits.append((p, x))
    rec(o, path)
    return hits

print("== 1) قائمة storage stores (بالتيم وبالشخصي):")
stores = {}
for qs, label in [(f"?teamId={TEAM}", "team"), ("", "personal")]:
    r = api(f"/v1/storage/stores{qs}")
    if "__err" in r:
        print(f"  [{label}] HTTP {r['__err']}: {r.get('__body','')[:120]}")
    else:
        for s in r.get("stores", []):
            print(f"  [{label}] {s.get('id')} | {s.get('name')} | type={s.get('type')} | created={s.get('created_at')} | by={s.get('created_by')}")
            stores[s.get("id")] = s

print("\n== 2) تفاصيل store_oRwE0iJLAiBxkgeM (direct + teamId):")
for qs, label in [("", "personal"), (f"?teamId={TEAM}", "team")]:
    r = api(f"/v1/storage/stores/store_oRwE0iJLAiBxkgeM{qs}")
    if "__err" in r:
        print(f"  [{label}] HTTP {r['__err']}: {r.get('__body','')[:150]}")
    else:
        print(f"  [{label}] keys: {sorted(r.keys())}")
        meta = r.get("metadata") or {}
        for k, v in meta.items():
            sv = str(v)
            print(f"    metadata.{k} = {mask_url(sv) if '://' in sv else sv[:100]}")
        for p, u in scan_obj(r, label):
            print(f"    URL@{p} = {u}")

print("\n== 3) integrations configurations:")
r = api(f"/v1/integrations/configurations?teamId={TEAM}&view=project")
if isinstance(r, dict) and "__err" in r:
    print(f"  HTTP {r['__err']}: {r.get('__body','')[:120]}")
else:
    items = r if isinstance(r, list) else (r.get("configurations") or r.get("integrations") or [])
    for c in items:
        if isinstance(c, dict):
            print(f"  {c.get('id')} | {c.get('integrationSlug') or c.get('slug')} | {c.get('name')} | project={c.get('projectId')}")
            for p, u in scan_obj(c):
                print(f"    URL@{p} = {u}")
        else:
            print(f"  item: {str(c)[:120]}")
print("\n== 4) connections على الـ store الحالي (لو متاح):")
for qs, label in [("", "personal"), (f"?teamId={TEAM}", "team")]:
    r = api(f"/v1/storage/stores/store_oRwE0iJLAiBxkgeM/connections{qs}")
    if "__err" in r:
        print(f"  [{label}] HTTP {r['__err']}")
    else:
        print(f"  [{label}] connections: {json.dumps(r)[:300]}")
        for p, u in scan_obj(r, label):
            print(f"    URL@{p} = {u}")
