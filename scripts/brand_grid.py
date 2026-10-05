#!/usr/bin/env python3
"""Overlay a labeled coordinate grid on the brand sheet to pick crop boxes."""
from PIL import Image, ImageDraw

SRC = "/home/z/my-project/upload/AlNokhba Management Brand System.png"
OUT = "/home/z/my-project/scripts/brand-grid.png"

im = Image.open(SRC).convert("RGB")
W, H = im.size
d = ImageDraw.Draw(im)

step = 50
for x in range(0, W, step):
    c = (255, 0, 0) if x % 200 == 0 else (0, 160, 255)
    d.line([(x, 0), (x, H)], fill=c, width=1)
    if x % 100 == 0:
        d.text((x + 2, 2), str(x), fill=(255, 0, 0))
for y in range(0, H, step):
    c = (255, 0, 0) if y % 200 == 0 else (0, 160, 255)
    d.line([(0, y), (W, y)], fill=c, width=1)
    if y % 100 == 0:
        d.text((2, y + 2), str(y), fill=(255, 0, 0))

im.save(OUT)
print("saved", OUT, im.size)
