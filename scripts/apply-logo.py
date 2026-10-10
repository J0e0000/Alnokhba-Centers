#!/usr/bin/env python3
"""Process the AlNokhba logo (upload/alnokhba centers no text.jpeg) into:
   - public/logo.png          transparent background, content bbox (for in-app marks)
   - public/icon-192.png      192x192 square icon (PWA)
   - public/icon-512.png      512x512 square icon (PWA)
   - public/icon-maskable-512.png  maskable with safe zone
   - public/apple-touch-icon.png   180x180 solid white bg
   - public/favicon.png       48x48
   Strategy: flood-fill background from the 4 edges (tolerance) -> content mask -> bbox.
"""
from PIL import Image, ImageFilter
from collections import deque
import sys, os

SRC = "/home/z/my-project/upload/alnokhba centers no text.jpeg"
OUT = "/home/z/my-project/public"

img = Image.open(SRC).convert("RGB")
w, h = img.size
px = img.load()

# ---------- 1) flood fill background from edges ----------
# background is light gray (~#EBEBEB). tolerance on RGB distance
def bg_like(p):
    r, g, b = p
    return abs(r - 236) < 26 and abs(g - 236) < 26 and abs(b - 236) < 26 and abs(r - g) < 12 and abs(g - b) < 12

bg = [[False] * w for _ in range(h)]
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        if bg_like(px[x, y]) and not bg[y][x]:
            bg[y][x] = True; dq.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if bg_like(px[x, y]) and not bg[y][x]:
            bg[y][x] = True; dq.append((x, y))
while dq:
    x, y = dq.popleft()
    for nx, ny in ((x+1,y), (x-1,y), (x,y+1), (x,y-1)):
        if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx] and bg_like(px[nx, ny]):
            bg[ny][nx] = True; dq.append((nx, ny))

# content = not background
content_pixels = sum(1 for y in range(h) for x in range(w) if not bg[y][x])
print(f"image {w}x{h}, background flood-filled, content pixels: {content_pixels} ({100*content_pixels/(w*h):.1f}%)")

# ---------- 2) content bbox with row/col profiles ----------
rows = [sum(1 for x in range(w) if not bg[y][x]) for y in range(h)]
cols = [sum(1 for y in range(h) if not bg[y][x]) for x in range(w)]
ys = [y for y in range(h) if rows[y] > 2]
xs = [x for x in range(w) if cols[x] > 2]
if not ys or not xs:
    print("ERROR: no content found"); sys.exit(1)
top, bot, left, right = min(ys), max(ys), min(xs), max(xs)
print(f"content bbox: x[{left}..{right}] y[{top}..{bot}]  ({right-left+1}x{bot-top+1})")

# find horizontal gaps (rows with near-zero content) inside the bbox -> emblem vs text separation
gaps = []
in_gap = False
for y in range(top, bot + 1):
    if rows[y] <= 2:
        if not in_gap: in_gap = True; gap_start = y
    else:
        if in_gap: gaps.append((gap_start, y - 1)); in_gap = False
gaps = [(a, b) for a, b in gaps if b - a >= 4]
print("horizontal gaps (band, height):", [(a, b, b - a + 1) for a, b in gaps])

# ---------- 3) cut alpha image ----------
def cut(x0, y0, x1, y1, pad_ratio=0.0):
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    padx, pady = int(cw * pad_ratio), int(ch * pad_ratio)
    x0 -= padx; x1 += padx; y0 -= pady; y1 += pady
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(w - 1, x1); y1 = min(h - 1, y1)
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    op = out.load()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if bg[y][x]:
                continue
            r, g, b = px[x, y]
            op[x - x0, y - y0] = (r, g, b, 255)
    return out

# emblem-only: content above the biggest gap (if a meaningful gap exists), else full content
emblem_top, emblem_bot = top, bot
if gaps:
    # biggest gap = emblem/text separator
    ga, gb = max(gaps, key=lambda g: g[1] - g[0])
    if gb < (top + bot) // 2 + (bot - top) // 4:  # gap in lower 75% -> text below
        emblem_bot = ga - 1
        print(f"emblem band: y[{top}..{emblem_bot}] (text band y[{gb+1}..{bot}] skipped for small marks)")
emblem = cut(left, emblem_top, right, emblem_bot)
full = cut(left, top, right, bot)
emblem.save(f"{OUT}/_emblem_dbg.png")
full.save(f"{OUT}/_full_dbg.png")
print("debug saved: _emblem_dbg.png", emblem.size, " _full_dbg.png", full.size)

# ---------- 4) square icons ----------
def square(size, im, fill_ratio, bg_color=(255, 255, 255, 255), pad_extra=0.0):
    canvas = Image.new("RGBA", (size, size), bg_color)
    avail = int(size * (fill_ratio - pad_extra))
    ratio = min(avail / im.width, avail / im.height)
    nw, nh = max(1, int(im.width * ratio)), max(1, int(im.height * ratio))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    canvas.alpha_composite(im2, ((size - nw) // 2, (size - nh) // 2))
    return canvas.convert("RGB") if bg_color[3] == 255 else canvas

# white icons (PWA needs solid squares; logo bg is near-white so seamless)
square(192, emblem, 0.78).save(f"{OUT}/icon-192.png")
square(512, emblem, 0.78).save(f"{OUT}/icon-512.png")
square(512, emblem, 0.56).save(f"{OUT}/icon-maskable-512.png")  # maskable safe zone
square(180, emblem, 0.80).save(f"{OUT}/apple-touch-icon.png")
square(48, emblem, 0.86).save(f"{OUT}/favicon.png")

# in-app logo: emblem, transparent, slight padding
logo = cut(left, emblem_top, right, emblem_bot, pad_ratio=0.03)
# resize to reasonable max dimension for web (e.g. height <= 360)
if logo.height > 360:
    r = 360 / logo.height
    logo = logo.resize((int(logo.width * r), 360), Image.LANCZOS)
logo.save(f"{OUT}/logo.png")
# full logo with text (bigger placements e.g. print headers)
fulllogo = cut(left, top, right, bot, pad_ratio=0.03)
if fulllogo.height > 420:
    r = 420 / fulllogo.height
    fulllogo = fulllogo.resize((int(fulllogo.width * r), int(fulllogo.height * r)), Image.LANCZOS)
fulllogo.save(f"{OUT}/logo-full.png")
print("saved:", ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon.png", "logo.png", "logo-full.png"])
