#!/usr/bin/env python3
"""
ALNOKHBA — Vercel Deployment Retention Cleanup
KEEP: latest 2 production READY (live + instant rollback) + newest preview per active feature branch.
DELETE: everything else (all deletions are rebuildable — every sha lives in origin/main git history).
Usage: python3 scripts/vercel_cleanup.py [--execute]   (default = DRY RUN)
"""
import json, os, sys, time, urllib.request, urllib.error, datetime

BASE = "https://api.vercel.com"
TEAM = "team_w8PxkM7uGzBh1Dh5rbqAoHki"
PROJ = "prj_Z5WHaJnlKq894WWFv5tQBblWa74b"
TOKEN_PATH = os.path.join(os.path.dirname(__file__), ".vercel-token")
EXECUTE = "--execute" in sys.argv

def tok():
    with open(TOKEN_PATH) as f: return f.read().strip()

def req(path, method="GET", retries=3):
    for i in range(retries):
        r = urllib.request.Request(BASE + path, method=method)
        r.add_header("Authorization", "Bearer " + tok())
        try:
            with urllib.request.urlopen(r, timeout=45) as resp:
                b = resp.read().decode("utf-8", "replace")
                return resp.status, json.loads(b) if b.strip().startswith(("{","[")) else b
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:200]
            if e.code == 429 and i < retries - 1:
                time.sleep(6); continue
            return e.code, body
        except Exception as e:
            if i < retries - 1: time.sleep(3); continue
            return -1, str(e)

def fetch_all():
    deps, until, pages = [], None, 0
    while True:
        q = f"?projectId={PROJ}&teamId={TEAM}&limit=100"
        if until: q += f"&until={until}"
        st, data = req("/v6/deployments" + q)
        if st != 200: raise SystemExit(f"list fail {st} {data}")
        batch = data.get("deployments", [])
        deps.extend(batch)
        nxt = (data.get("pagination") or {}).get("next")
        if not nxt or not batch or pages > 60: break
        until = nxt; pages += 1
    deps.sort(key=lambda d: d.get("createdAt", 0), reverse=True)
    return deps

def ts(ms): return datetime.datetime.utcfromtimestamp(ms/1000).strftime("%m-%d %H:%M")

# ---------- fetch + classify ----------
deps = fetch_all()
prod_ready = [d for d in deps if d.get("target") == "production" and d.get("readyState") == "READY"]
keep, keep_ids = [], set()

for d in prod_ready[:2]:  # live + instant-rollback
    keep.append((d, "PROD latest/rollback")); keep_ids.add(d["uid"])

latest_preview_by_branch = {}
for d in deps:
    if d.get("target") != "production" and d.get("readyState") == "READY":
        b = (d.get("meta") or {}).get("githubCommitRef") or "?"
        if b not in latest_preview_by_branch:
            latest_preview_by_branch[b] = d
for b, d in latest_preview_by_branch.items():
    keep.append((d, f"PREVIEW newest for branch {b}")); keep_ids.add(d["uid"])

delete = [d for d in deps if d["uid"] not in keep_ids]
# safety: never delete anything still building/queued
delete = [d for d in delete if d.get("readyState") == "READY"]
building = [d for d in deps if d.get("readyState") != "READY"]

# ---------- usage extras for the report ----------
print("== builds usage (per day, churn evidence) ==")
st, data = req(f"/v2/usage?teamId={TEAM}&type=builds&from=2026-10-07T00%3A00%3A00.000Z&to=2026-10-14T00%3A00%3A00.000Z")
if st == 200:
    for row in (data.get("data") or []):
        print(f"  {row.get('date','')[:10]}  completed={row.get('build_completed_count')}  build_sec={round(row.get('build_build_seconds') or 0)}")
for t in ("storage_blob", "storage_postgres", "storage_redis", "artifacts", "data_cache"):
    st, data = req(f"/v2/usage?teamId={TEAM}&type={t}&from=2026-10-07T00%3A00%3A00.000Z&to=2026-10-14T00%3A00%3A00.000Z")
    print(f" usage type={t}: {'EMPTY/none' if st==200 and not (data.get('data') if isinstance(data,dict) else data) else (str(data)[:150] if st!=200 else 'HAS DATA')}")

# ---------- report ----------
print(f"\n== CLEANUP PLAN (mode={'EXECUTE' if EXECUTE else 'DRY RUN'}) ==")
print(f" total={len(deps)}  keep={len(keep)}  delete={len(delete)}  building/queued={len(building)}")
print("\n KEEP:")
for d, why in keep:
    print(f"  + {d['uid']}  {ts(d['createdAt'])}  {d.get('target') or 'preview':9s} {(d.get('meta') or {}).get('githubCommitRef','-'):28s} {why}")
print("\n DELETE (first 40):")
for d in delete[:40]:
    m = d.get("meta") or {}
    print(f"  - {d['uid']}  {ts(d['createdAt'])}  {d.get('target') or 'preview':9s} {m.get('githubCommitRef','-'):28s} {m.get('githubCommitSha','')[:7]}")

if not EXECUTE:
    print("\nDRY RUN — re-run with --execute to delete.")
    sys.exit(0)

# ---------- execute ----------
ok, fail = [], []
for i, d in enumerate(delete):
    st, data = req(f"/v13/deployments/{d['uid']}?teamId={TEAM}", method="DELETE")
    tag = "OK" if st in (200,) else f"FAIL {st}"
    (ok if st == 200 else fail).append(d["uid"])
    print(f"  [{i+1}/{len(delete)}] {d['uid']} {ts(d['createdAt'])} -> {tag} {str(data)[:80] if st != 200 else ''}")
    time.sleep(0.7)

print(f"\n deleted={len(ok)} failed={len(fail)}")
if fail: print(" failed uids:", fail)

# ---------- after ----------
time.sleep(3)
after = fetch_all()
print(f"\n== AFTER: deployments remaining = {len(after)} (was {len(deps)}) ==")
for d in after:
    print(f"  {d['uid']}  {ts(d['createdAt'])}  {d.get('target') or 'preview':9s} {(d.get('meta') or {}).get('githubCommitRef','-')}")

with open(os.path.join(os.path.dirname(__file__), "vercel_cleanup_result.json"), "w") as f:
    json.dump({"before": len(deps), "deleted": ok, "failed": fail, "after": len(after),
               "deletedAt": int(time.time()*1000)}, f, indent=1)
print(" result saved: scripts/vercel_cleanup_result.json")
