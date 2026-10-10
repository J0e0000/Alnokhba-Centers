#!/usr/bin/env python3
"""Extract exact brand colors from the Alnokhba logo (source of truth)."""
from PIL import Image
from collections import Counter
import colorsys

def analyze(path, label):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = list(im.getdata())
    # only opaque pixels
    opaque = [(r, g, b) for (r, g, b, a) in px if a > 200]
    print(f"\n=== {label} ({path}) {im.size} — {len(opaque)} opaque px ===")

    # quantize to buckets of 16 to cluster
    def bucket(c):
        return (c[0] // 16 * 16, c[1] // 16 * 16, c[2] // 16 * 16)
    cnt = Counter(bucket(c) for c in opaque)
    # also count exact colors
    exact = Counter(opaque)
    print("Top 12 exact colors:")
    for c, n in exact.most_common(12):
        hexc = '#%02X%02X%02X' % c
        hsv = colorsys.rgb_to_hsv(c[0]/255, c[1]/255, c[2]/255)
        print(f"  {hexc}  n={n:6d}  hue={hsv[0]*360:5.1f}  sat={hsv[1]:.2f}  val={hsv[2]:.2f}")

    # classify into hue families
    fams = {}
    for c, n in exact.items():
        hsv = colorsys.rgb_to_hsv(c[0]/255, c[1]/255, c[2]/255)
        hue, sat, val = hsv[0]*360, hsv[1], hsv[2]
        if sat < 0.12:
            fam = 'gray'
        elif hue < 20 or hue >= 340:
            fam = 'red'
        elif hue < 45:
            fam = 'orange/brown'
        elif hue < 70:
            fam = 'yellow'
        elif hue < 160:
            fam = 'green'
        elif hue < 260:
            fam = 'blue'
        else:
            fam = 'purple'
        if fam not in fams:
            fams[fam] = []
        fams[fam].append((c, n))
    print("Hue families:")
    for fam, items in sorted(fams.items(), key=lambda x: -sum(n for _, n in x[1])):
        tot = sum(n for _, n in items)
        dom = max(items, key=lambda x: x[1])
        # weighted average of top colors
        top = sorted(items, key=lambda x: -x[1])[:5]
        avg = tuple(sum(c[i]*n for c, n in top)//sum(n for _, n in top) for i in range(3))
        print(f"  {fam:12s} total={tot:7d}  dominant=#{dom[0][0]:02X}{dom[0][1]:02X}{dom[0][2]:02X}  avg=#{avg[0]:02X}{avg[1]:02X}{avg[2]:02X}")

analyze('upload/alnokhba centers no text.jpeg', 'ALNOKHBA LOGO (no text, source of truth)')
analyze('public/logo.png', 'CURRENT PROCESSED LOGO (in app)')
analyze('public/icon-512.png', 'CURRENT PWA ICON')
