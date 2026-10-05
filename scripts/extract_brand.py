#!/usr/bin/env python3
"""Extract brand assets v2 — flood-fill background removal for the app icon
(keeps the WHITE glyph inside the navy tile), global white-key for flat lockups."""
from PIL import Image, ImageDraw, ImageFilter
from collections import deque

SRC = "/home/z/my-project/upload/AlNokhba Management Brand System.png"
PUB = "/home/z/my-project/public"
sheet = Image.open(SRC).convert("RGB")

# ---------- global white key (flat art with no enclosed white) ----------
def white_to_alpha(img, thr=250, boost=3.0):
    im = img.convert("RGB"); out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    po, pp = out.load(), im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = pp[x, y]
            lum = (r + g + b) / 3.0; sat = max(r, g, b) - min(r, g, b)
            if (lum >= thr and sat < 10) or lum > 252.5:
                po[x, y] = (0, 0, 0, 0); continue
            a = int(max(0, min(255, (255.0 - lum) * boost)))
            if a == 0:
                po[x, y] = (0, 0, 0, 0); continue
            af = a / 255.0
            r2 = int(max(0, min(255, (r - (1 - af) * 255) / af)))
            g2 = int(max(0, min(255, (g - (1 - af) * 255) / af)))
            b2 = int(max(0, min(255, (b - (1 - af) * 255) / af)))
            po[x, y] = (r2, g2, b2, a)
    return out

# ---------- flood-fill bg removal (icon with enclosed white glyph) ----------
def flood_bg_alpha(img, lum_thr=232, sat_thr=30):
    """Remove only border-connected near-white pixels. Interior stays opaque.
    Pixels adjacent to bg (1px ring) get de-blended for smooth edges."""
    im = img.convert("RGB"); W, H = im.size
    pp = im.load()
    is_bgish = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r, g, b = pp[x, y]
            is_bgish[y][x] = (r + g + b) / 3.0 >= lum_thr and (max(r, g, b) - min(r, g, b)) <= sat_thr
    seen = [[False] * W for _ in range(H)]
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if is_bgish[y][x] and not seen[y][x]:
                seen[y][x] = True; q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if is_bgish[y][x] and not seen[y][x]:
                seen[y][x] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and is_bgish[ny][nx] and not seen[ny][nx]:
                seen[ny][nx] = True; q.append((nx, ny))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0)); po = out.load()
    for y in range(H):
        for x in range(W):
            r, g, b = pp[x, y]
            if seen[y][x]:
                po[x, y] = (0, 0, 0, 0); continue
            lum = (r + g + b) / 3.0; sat = max(r, g, b) - min(r, g, b)
            near_bg = any(0 <= x+dx < W and 0 <= y+dy < H and seen[y+dy][x+dx]
                          for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1)))
            if near_bg and lum > 150:
                # anti-aliased edge: de-blend from white
                a = int(max(0, min(255, (255.0 - lum) * 1.6)))
                if a == 0:
                    po[x, y] = (0, 0, 0, 0); continue
                af = a / 255.0
                r2 = int(max(0, min(255, (r - (1 - af) * 255) / af)))
                g2 = int(max(0, min(255, (g - (1 - af) * 255) / af)))
                b2 = int(max(0, min(255, (b - (1 - af) * 255) / af)))
                po[x, y] = (r2, g2, b2, a)
            else:
                po[x, y] = (r, g, b, 255)
    return out

def navy_to_white_alpha(img):
    im = img.convert("RGB"); out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    po, pp = out.load(), im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = pp[x, y]
            lum = (r + g + b) / 3.0
            a = int(max(0, min(255, (lum - 35) * 255 / (225 - 35))))
            if a: po[x, y] = (255, 255, 255, a)
    return out

def trim(img, pad=2):
    b = img.getbbox()
    if not b: return img
    l, t, r, bt = b
    return img.crop((max(0, l-pad), max(0, t-pad), min(img.width, r+pad), min(img.height, bt+pad)))

def square_pad(img):
    s = max(img.width, img.height)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(img, ((s - img.width) // 2, (s - img.height) // 2))
    return out

def fit(img, size):
    w, h = img.size; s = size / max(w, h)
    return img.resize((max(1, round(w*s)), max(1, round(h*s))), Image.LANCZOS)

def save(img, name, size=None):
    if size: img = fit(img, size)
    img.save(f"{PUB}/{name}"); print(f"saved {name:24s} {img.size}")

# ---------- crops ----------
CROPS = {
    "primary":   (88, 105, 730, 280),
    "appicon":   (860, 96, 1060, 294),
    "standalone":(1218, 85, 1398, 300),
    "vertical":  (950, 368, 1155, 528),
    "pill":      (550, 643, 742, 755),
}
c = {k: sheet.crop(b) for k, b in CROPS.items()}

mark    = trim(white_to_alpha(c["standalone"]))
appicon = square_pad(trim(flood_bg_alpha(c["appicon"])))
full    = trim(white_to_alpha(c["primary"]))
vert    = trim(white_to_alpha(c["vertical"]))

# white monochrome = recolor the clean full-color lockup (any opaque pixel → white)
def to_white(src):
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    out.putdata([(255, 255, 255, a) for (r, g, b, a) in src.getdata()])
    return out
white     = trim(to_white(full))
white_sym = trim(to_white(mark))

# ---------- system assets ----------
save(appicon, "logo.png", 256)
save(full,    "logo-full.png", 720)
save(mark,    "logo-mark.png", 256)
save(white,   "logo-white.png", 640)
save(white_sym, "logo-mark-white.png", 256)
save(vert, "logo-vertical.png", 512)

# ---------- favicon / PWA ----------
save(appicon, "favicon.png", 64)
save(appicon, "icon-192.png", 192)
save(appicon, "icon-512.png", 512)
save(appicon, "apple-touch-icon.png", 180)
big = appicon.resize((int(512*1.3), int(512*1.3)), Image.LANCZOS)
off = ((big.width-512)//2, (big.height-512)//2)
big.crop((off[0], off[1], off[0]+512, off[1]+512)).save(f"{PUB}/icon-maskable-512.png")
print("saved icon-maskable-512.png (512, 512)")

# ---------- og.jpg ----------
NAVY = (11, 27, 79)
W, H = 1200, 630
og = Image.new("RGB", (W, H), NAVY)
d = ImageDraw.Draw(og, "RGBA")
for i in range(W + H):
    t = i / (W + H)
    rr = int(0x0B + (0x12 - 0x0B) * t); gg = int(0x1B + (0x2A - 0x1B) * t); bb = int(0x4F + (0x6E - 0x4F) * t)
    d.line([(i - H, 0), (i, H)], fill=(rr, gg, bb))
for cx, cy, rad, col in [(140, 560, 300, (16, 185, 129, 26)), (1080, 80, 340, (37, 99, 235, 34))]:
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx-rad, cy-rad, cx+rad, cy+rad], fill=col)
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    og = Image.alpha_composite(og.convert("RGBA"), glow).convert("RGB")
lw = white.copy(); tw = int(W * 0.52)
lw = lw.resize((tw, int(lw.height * tw / lw.width)), Image.LANCZOS)
og.paste(lw, ((W - lw.width)//2, (H - lw.height)//2), lw)
og.save(f"{PUB}/og.jpg", quality=90)
print("saved og.jpg", og.size)
print("DONE")
