#!/usr/bin/env python3
"""
ALNOKHBA — Vercel Storage Forensics (read-only phase)
Token: scripts/.vercel-token (never printed)
Outputs: scripts/vercel_inventory_<ts>.json + console summary
"""
import json, os, sys, time, urllib.request, urllib.error, datetime

BASE = "https://api.vercel.com"
TEAM = "team_w8PxkM7uGzBh1Dh5rbqAoHki"
PROJ = "prj_Z5WHaJnlKq894WWFv5tQBblWa74b"
TOKEN_PATH = os.path.join(os.path.dirname(__file__), ".vercel-token")

def tok():
    with open(TOKEN_PATH) as f:
        return f.read().strip()

def req(path, method="GET", ok=(200,), quiet=False):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header("Authorization", "Bearer " + tok())
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(body) if body.strip().startswith(("{", "[")) else body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        return e.code, body
    except Exception as e:
        return -1, str(e)

def main():
    now_ms = int(time.time() * 1000)
    print(f"== VERCEL FORENSICS @ {datetime.datetime.utcnow().isoformat()}Z ==")

    # ---------- 1. Deployments full pagination ----------
    deps = []
    until = None
    pages = 0
    while True:
        q = f"?projectId={PROJ}&teamId={TEAM}&limit=100"
        if until:
            q += f"&until={until}"
        st, data = req("/v6/deployments" + q)
        if st != 200:
            print(" deployments list FAIL", st, str(data)[:200]); break
        batch = data.get("deployments", [])
        deps.extend(batch)
        pages += 1
        nxt = (data.get("pagination") or {}).get("next")
        if not nxt or not batch:
            break
        until = nxt
        if pages > 60:
            print(" pagination cap hit"); break
    print(f" deployments fetched: {len(deps)} (pages={pages})")

    inv = []
    for d in deps:
        meta = d.get("meta") or {}
        inv.append({
            "uid": d.get("uid"),
            "state": d.get("state") or d.get("readyState"),
            "target": d.get("target"),
            "createdAt": d.get("createdAt"),
            "ageDays": round((now_ms - d.get("createdAt", 0)) / 86400000, 2),
            "branch": meta.get("githubCommitRef"),
            "sha": (meta.get("githubCommitSha") or "")[:7],
            "msg": (meta.get("githubCommitMessage") or "")[:60],
            "user": (meta.get("githubCommitAuthorLogin") or meta.get("githubCommitAuthorName") or ""),
            "url": d.get("url"),
            "aliasError": d.get("aliasError"),
        })
    inv.sort(key=lambda x: x["createdAt"], reverse=True)

    # ---------- 2. Size discovery on a sample ----------
    size_fields = {}
    sample = [x["uid"] for x in inv[:3]]
    for uid in sample:
        st, det = req(f"/v13/deployments/{uid}?teamId={TEAM}")
        if st == 200 and isinstance(det, dict):
            top = {k: (type(v).__name__) for k, v in det.items()}
            size_fields[uid] = top
            insp = det.get("insights") or {}
            print(f" sample {uid}: state={det.get('readyState')} topKeys={sorted(top.keys())}")
            if insp:
                print(f"   insights keys: {sorted(insp.keys())}")
                print(f"   insights.build: {json.dumps(insp.get('build'))[:400]}")
        else:
            print(f" sample {uid}: detail {st} {str(det)[:150]}")
        time.sleep(0.3)

    # ---------- 3. Usage/billing endpoint probing ----------
    candidates = [
        f"/v4/billing/usage?teamId={TEAM}",
        f"/v1/billing/usage?teamId={TEAM}",
        f"/v1/usage?teamId={TEAM}",
        f"/v2/usage?teamId={TEAM}",
        f"/v3/usage?teamId={TEAM}",
        f"/v1/teams/{TEAM}/usage",
        f"/v2/teams/{TEAM}/billing/usage",
        f"/v1/storage?teamId={TEAM}",
        f"/v2/storage?teamId={TEAM}",
        f"/v1/projects/{PROJ}/usage?teamId={TEAM}",
    ]
    print(" -- usage endpoint probes --")
    for c in candidates:
        st, data = req(c)
        head = json.dumps(data)[:300] if not isinstance(data, str) else data[:150]
        print(f"  {st} {c} :: {head}")

    # ---------- 4. Summary ----------
    st_count, err_count, canc_count, other = 0, 0, 0, 0
    for x in inv:
        s = x["state"]
        if s == "READY": st_count += 1
        elif s == "ERROR": err_count += 1
        elif s == "CANCELED": canc_count += 1
        else: other += 1
    prod = [x for x in inv if x["target"] == "production"]
    print(" -- summary --")
    print(f" total={len(inv)} READY={st_count} ERROR={err_count} CANCELED={canc_count} OTHER={other}")
    print(f" production-target={len(prod)}")
    if inv:
        oldest = inv[-1]; newest = inv[0]
        print(f" newest: {newest['uid']} {datetime.datetime.utcfromtimestamp(newest['createdAt']/1000)} state={newest['state']} target={newest['target']} branch={newest['branch']}")
        print(f" oldest: {oldest['uid']} {datetime.datetime.utcfromtimestamp(oldest['createdAt']/1000)} state={oldest['state']} target={oldest['target']} branch={oldest['branch']}")
    branches = {}
    for x in inv:
        b = x["branch"] or "?"
        branches[b] = branches.get(b, 0) + 1
    print(" branches:", json.dumps(branches))
    states_list = [(x["uid"], datetime.datetime.utcfromtimestamp(x["createdAt"]/1000).strftime("%m-%d %H:%M"), x["state"], x["target"] or "preview", x["branch"] or "-", x["sha"]) for x in inv[:40]]
    for row in states_list:
        print("   ", *row)

    out = os.path.join(os.path.dirname(__file__), f"vercel_inventory_{time.strftime('%Y%m%d_%H%M%S')}.json")
    with open(out, "w") as f:
        json.dump({"fetchedAt": now_ms, "team": TEAM, "project": PROJ, "count": len(inv), "deployments": inv, "sampleDetailKeys": size_fields}, f, indent=1)
    print(" inventory saved:", out)

if __name__ == "__main__":
    main()
