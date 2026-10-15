# -*- coding: utf-8 -*-
"""session-live.tsx surgery step 1: delete InteractionStage + ExamsStage blocks."""
P = "/home/z/my-project/src/components/nokhba/session-live.tsx"
lines = open(P, encoding="utf-8").read().split("\n")

def cut(a, b, why, first_anchor, last_anchor):
    assert first_anchor in lines[a - 1], f"first anchor mismatch: {lines[a-1]!r}"
    assert last_anchor in lines[b - 1], f"last anchor mismatch: {lines[b-1]!r}"
    print(f"CUT {a}..{b} ({b-a+1}) — {why}")
    del lines[a - 1 : b]

# bottom-up
cut(1205, 1477, "ExamsStage component + header comment", "/* =", "")
cut(1063, 1191, "InteractionStage component + header comment", "/* =", "")

open(P, "w", encoding="utf-8").write("\n".join(lines))
print("OK —", len(lines), "lines")
