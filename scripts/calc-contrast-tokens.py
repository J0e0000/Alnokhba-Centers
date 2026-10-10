"""Compute WCAG-AA-safe color tokens for the Nokhba theme."""
import math

def hex2rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def rgb2hex(c): return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in c)
def mix(a, b, share_a):
    return tuple(a[i] * share_a + b[i] * (1 - share_a) for i in range(3))
def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def contrast(a, b):
    l1, l2 = lum(a), lum(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)

def darken_to(hex_c, target, bgs):
    """min darkening (mix with black) so contrast vs every bg >= target"""
    rgb = hex2rgb(hex_c)
    for keep in range(100, 9, -1):
        m = mix(rgb, (0, 0, 0), keep / 100)
        if all(contrast(m, hex2rgb(b)) >= target for b in bgs):
            return rgb2hex(m), 100 - keep
    return rgb2hex(mix(rgb, (0, 0, 0), 0.1)), 90

def lighten_to(hex_c, target, bgs):
    """min lightening (mix with white) so contrast vs every bg >= target"""
    rgb = hex2rgb(hex_c)
    for keep in range(100, 9, -1):
        m = mix(rgb, (255, 255, 255), keep / 100)
        if all(contrast(m, hex2rgb(b)) >= target for b in bgs):
            return rgb2hex(m), 100 - keep
    return "#ffffff", 100

WHITE, APPBG, DARKCARD, DARKBG = "#ffffff", "#f5f7fa", "#131c2b", "#0d1420"

brands = {
    "navy (النخبة)": "#143159",
    "green (الأمل)": "#0E9F6E",
    "amber (سنتر 3)": "#B45309",
    "teal (سابق)": "#0F766E",
}
print("=" * 90)
for name, hex_c in brands.items():
    strong, dk = darken_to(hex_c, 5.0, [WHITE, APPBG])
    # dark soft bg = 22% brand + card
    soft_dark = rgb2hex(mix(hex2rgb(hex_c), hex2rgb(DARKCARD), 0.22))
    lift, lt = lighten_to(hex_c, 4.6, [DARKCARD, DARKBG, soft_dark])
    print(f"{name:16s} {hex_c}")
    print(f"   --c-primary-strong: {strong}  (black {dk}%)   white-on-it={contrast(hex2rgb(strong), hex2rgb(WHITE)):.2f}  on-appbg={contrast(hex2rgb(strong), hex2rgb(APPBG)):.2f}")
    print(f"   --c-primary-lift:   {lift}  (white {lt}%)   vs card={contrast(hex2rgb(lift), hex2rgb(DARKCARD)):.2f}  vs soft-dark {soft_dark}={contrast(hex2rgb(lift), hex2rgb(soft_dark)):.2f}")

print("=" * 90)
sec = "#1D4477"
s_strong, _ = darken_to(sec, 5.0, [WHITE, APPBG])
print(f"secondary {sec} -> strong {s_strong}")
gold = "#D5A134"
g_strong, gk = darken_to(gold, 5.0, [WHITE, APPBG])
print(f"accent {gold} -> strong {g_strong} (black {gk}%)  on-white={contrast(hex2rgb(g_strong), hex2rgb(WHITE)):.2f}")
gold_deep = "#8F6B1E"
print(f"gold-deep {gold_deep} on-white={contrast(hex2rgb(gold_deep), hex2rgb(WHITE)):.2f} on-appbg={contrast(hex2rgb(gold_deep), hex2rgb(APPBG)):.2f}")

print("=" * 90)
print("--- Tailwind token candidates ---")
for name, c in [("emerald-600 current ~#009966", "#009966"), ("emerald-700 #047857", "#047857"),
                ("rose-500 current ~#ff2056", "#ff2056"), ("rose-600 #e11d48", "#e11d48"),
                ("red-600 current ~#e7000b", "#e7000b"), ("red-700 #b91c1c", "#b91c1c"),
                ("cand red-600 #d01212", "#d01212"), ("cand red-600 #d31a1a", "#d31a1a")]:
    r = hex2rgb(c)
    print(f"{name:28s} white={contrast(r, hex2rgb(WHITE)):.2f}  red50(#fff1f0)={contrast(r, hex2rgb('#fff1f0')):.2f}  em50(#ecfdf5)={contrast(r, hex2rgb('#ecfdf5')):.2f}  darkcard={contrast(r, hex2rgb(DARKCARD)):.2f}")

print("--- white alphas on strong green ---")
for a in (0.75, 0.8, 0.85, 0.9, 0.95, 1.0):
    blended = mix((255, 255, 255), hex2rgb("#0a7b57"), a)  # white alpha over green
    print(f"white {a:.2f} on #0a7b57 ≈ {rgb2hex(blended)} ratio={contrast(blended, hex2rgb('#0a7b57')):.2f}")

print("--- rose-300 / emerald-300 / red-400 on dark card ---")
for name, c in [("rose-300 #fda4af", "#fda4af"), ("emerald-300 #6ee7b7", "#6ee7b7"), ("red-400 #f87171", "#f87171")]:
    print(f"{name:18s} vs darkcard={contrast(hex2rgb(c), hex2rgb(DARKCARD)):.2f}")
