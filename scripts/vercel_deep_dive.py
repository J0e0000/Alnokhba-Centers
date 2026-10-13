#!/usr/bin/env python3
"""Deep-dive: deployment sizes (functions/lambdas), usage APIs with params, project settings."""
import json, os, sys, time, urllib.request, urllib.error

BASE = "https://api.vercel.com"
TEAM = "team_w8PxkM7uGzBh1Dh5rbqAoHki"
PROJ = "prj_Z5WHaJnlKq894WWFv5tQBblWa74b"
TOKEN_PATH = os.path.join(os.path.dirname(__file__), ".vercel-token")

def tok():
    with open(TOKEN_PATH) as f: return f.read().strip()

def req(path, method="GET", body=None):
    r = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body else None)
    r.add_header("Authorization", "Bearer " + tok())
    if body: r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            b = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(b) if b.strip().startswith(("{","[")) else b
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return -1, str(e)

def human(n):
    if n is None: return "?"
    for u in ["B","KB","MB","GB"]:
        if n < 1024 or u == "GB": return f"{n:.1f}{u}"
        n /= 1024

# ---- 1. Full detail of newest PRODUCTION deployment (5ca65cc) — inspect functions/lambdas/build
print("== DETAIL: newest production dpl_G18fyEW7JwpBuuoBJB4RacCtDD1x ==")
st, d = req(f"/v13/deployments/dpl_G18fyEW7JwpBuuoBJB4RacCtDD1x?teamId={TEAM}")
if st == 200:
    print(" build:", json.dumps(d.get("build"), indent=1)[:600])
    fns = d.get("functions") or {}
    print(" functions type:", type(fns).__name__, "count:", len(fns) if hasattr(fns,'__len__') else 0)
    s = json.dumps(fns)
    print(" functions json head:", s[:900])
    lam = d.get("lambdas") or {}
    print(" lambdas json head:", json.dumps(lam)[:600])
else:
    print(" fail", st, d)

# ---- 2. usage v1 with from
now = int(time.time()*1000)
from7 = now - 7*86400000
print("\n== /v1/usage?from=7d ==")
st, d = req(f"/v1/usage?teamId={TEAM}&from={from7}&to={now}")
print(" ", st, json.dumps(d)[:1500] if st==200 else str(d)[:300])

print("\n== /v2/usage probes ==")
for t in ["deployments","deployment-storage","storage","bandwidth","all"]:
    st, d = req(f"/v2/usage?teamId={TEAM}&type={t}&from={from7}&to={now}")
    print(f"  type={t} ->", st, (json.dumps(d)[:400] if st==200 else str(d)[:200]))

# ---- 3. project settings (retention config?)
print("\n== project settings ==")
st, d = req(f"/v9/projects/{PROJ}?teamId={TEAM}")
if st == 200:
    keep = {k: v for k, v in d.items() if k in ("name","framework","nodeVersion","serverlessFunctionRegion","deploymentExpiration","expirationSettings","settings","autoExposeSystemEnvs","gitForkProtection")}
    print(" ", json.dumps(keep)[:800])
    s = d.get("settings") or {}
    print(" settings keys:", sorted(s.keys())[:60])
    for k in s:
        if "expire" in k.lower() or "retention" in k.lower() or "keep" in k.lower():
            print("  RETENTION-RELATED:", k, "=", json.dumps(s[k])[:300])
else:
    print(" fail", st, str(d)[:200])

# ---- 4. env vars list (names only, to find DATABASE_URL for DB audit) — DO NOT print values
print("\n== env var names (values NOT printed) ==")
st, d = req(f"/v9/projects/{PROJ}/env?teamId={TEAM}&decrypt=true")
if st == 200:
    envs = d.get("envs") or []
    for e in envs:
        print(f"  {e.get('key')} target={e.get('target')} type={e.get('type')} hasValue={'value' in e and bool(e.get('value'))}")
else:
    print("  fail", st, str(d)[:200])

# ---- 5. check blob/edge-config stores listing alternative path
print("\n== /v1/storage/stores ==")
st, d = req(f"/v1/storage/stores?teamId={TEAM}")
print(" ", st, (json.dumps(d)[:500] if st==200 else str(d)[:200]))
