#!/usr/bin/env python3
"""Diagnose logo-white alpha + composite preview on light/dark/navy backgrounds."""
from PIL import Image

PUB = "/home/z/my-project/public"
w = Image.open(f"{PUB}/logo-white.png")
print("size:", w.size, "mode:", w.mode)

# sample alpha at pill corners / edges / glyph
W, H = w.size
pts = {"pill-corner(8,8)": (8, 8), "pill-mid-top(W/2,6)": (W//2, 6), "pill-left-edge(4,H/2)": (4, H//2),
       "glyph-area(W*0.2,H/2)": (int(W*0.2), H//2), "center(W/2,H/2)": (W//2, H//2),
       "inside-pill(W*0.55,H*0.35)": (int(W*0.55), int(H*0.35))}
px = w.load()
for name, (x, y) in pts.items():
    print(f"{name:28s} rgba={px[x, y]}")

# composite on three backgrounds
for bgname, col in [("white", (255, 255, 255)), ("navy", (11, 27, 79)), ("dark", (11, 18, 32))]:
    bg = Image.new("RGB", w.size, col)
    bg.paste(w, (0, 0), w)
    bg.save(f"/home/z/my-project/scripts/white-on-{bgname}.png")
print("previews saved")
