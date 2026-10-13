#!/usr/bin/env python3
"""Probe: full /v2/usage types list, v1/usage ISO dates, v6 raw item keys, deployment files endpoint."""
import json, os, urllib.request, urllib.error, datetime

BASE = "https://api.vercel.com"
TEAM = "team_w8PxkM7uGzBh1Dh5rbqAoHki"
PROJ = "prj_Z5WHaJnlKq894WWFv5tQBblWa74b"
TOKEN_PATH = os.path.join(os.path.dirname(__file__), ".vercel-token")

def tok():
    with open(TOKEN_PATH) as f: return f.read().strip()

def req(path, method="GET"):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header("Authorization", "Bearer " + tok())
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            b = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(b) if b.strip().startswith(("{","[")) else b
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:1500]
    except Exception as e:
        return -1, str(e)

# 1. FULL allowed types for /v2/usage
st, d = req(f"/v2/usage?teamId={TEAM}&type=zzz")
print("== /v2/usage FULL allowed types ==")
print(st, d)

# 2. v1/usage with ISO date
print("\n== /v1/usage ISO ==")
st, d = req(f"/v1/usage?teamId={TEAM}&from=2026-10-07T00%3A00%3A00.000Z&to=2026-10-14T00%3A00%3A00.000Z")
print(st, (json.dumps(d)[:2000] if st == 200 else str(d)[:300]))

# 3. raw v6 item full keys (look for size)
print("\n== raw v6 item keys ==")
st, d = req(f"/v6/deployments?projectId={PROJ}&teamId={TEAM}&limit=1")
if st == 200:
    dep = d["deployments"][0]
    print(sorted(dep.keys()))
    for k in ("build","config","functions","images","routes","insights"):
        if k in dep:
            print(f" {k}:", json.dumps(dep[k])[:300])

# 4. deployment files endpoint probes
uid = "dpl_G18fyEW7JwpBuuoBJB4RacCtDD1x"
print("\n== deployment files endpoints ==")
for p in [f"/v6/deployments/{uid}/files?teamId={TEAM}", f"/v1/deployments/{uid}/files?teamId={TEAM}"]:
    st, d = req(p)
    head = json.dumps(d)[:400] if st == 200 and isinstance(d, (dict, list)) else str(d)[:200]
    print(f"  {st} {p[:60]} :: {head}")

# 5. artifacts / build-cache usage from v2/usage (types discovered above) — try likely ones
print("\n== /v2/usage candidate types ==")
for t in ["artifacts", "builds", "deployment_storage", "deployments_storage", "function_storage"]:
    st, d = req(f"/v2/usage?teamId={TEAM}&type={t}&from=2026-10-07T00%3A00%3A00.000Z&to=2026-10-14T00%3A00%3A00.000Z")
    s = json.dumps(d)[:600] if st == 200 and isinstance(d, (dict, list)) else str(d)[:250]
    print(f"  type={t} -> {st} :: {s}")
