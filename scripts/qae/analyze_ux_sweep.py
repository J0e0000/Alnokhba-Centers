#!/usr/bin/env python3
# تحليل نتائج UX Sweep v5 — overflow + تغطية العناصر
import json, collections, sys

PATH = "/home/z/my-project/qae/results/ux-sweep-v5.jsonl"
rows = []
with open(PATH) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
        except: continue
        m = d.get("m")
        if isinstance(m, str):
            try: m = json.loads(m)
            except: m = {}
        d["m"] = m or {}
        rows.append(d)

# dedupe: last wins
seen = {}
for r in rows: seen[(r["role"], r["theme"], r["vp"], r["view"])] = r
rows = list(seen.values())

print(f"total rows: {len(rows)}")
print("\n=== OVERFLOW (o>0) ===")
ov = [r for r in rows if r["m"].get("o", 0) > 0]
if not ov: print("  none ✓")
for r in sorted(ov, key=lambda x: -x["m"]["o"]):
    print(f"  {r['role']:9} {r['theme']:5} {r['vp']:9} {r['view']:12} overflow={r['m']['o']}px")

print("\n=== COVERED interactive elements (c>0) ===")
cv = [r for r in rows if r["m"].get("c", 0) > 0]
if not cv: print("  none ✓")
for r in sorted(cv, key=lambda x: -x["m"]["c"]):
    samples = "; ".join(r["m"].get("s", [])[:2])
    print(f"  {r['role']:9} {r['theme']:5} {r['vp']:9} {r['view']:12} covered={r['m']['c']}/{r['m'].get('n','?')} → {samples}")

print("\n=== per-view summary (max overflow, covered count across combos) ===")
byview = collections.defaultdict(list)
for r in rows: byview[r["view"]].append(r)
for v in sorted(byview):
    rs = byview[v]
    mo = max(r["m"].get("o", 0) for r in rs)
    mc = sum(1 for r in rs if r["m"].get("c", 0) > 0)
    print(f"  {v:12} combos={len(rs):3} maxOverflow={mo:3}px coveredCombos={mc}")
