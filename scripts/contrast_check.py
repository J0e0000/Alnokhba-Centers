#!/usr/bin/env python3
"""Verify WCAG contrast for the new AlNokhba Management palette decisions."""


def lum(hexv):
    h = hexv.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    def f(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


pairs = [
    # (fg, bg, note, needed)
    ("#0B1B4F", "#FFFFFF", "navy primary on white card", 4.5),
    ("#0B1B4F", "#F5F8FD", "navy on app background", 4.5),
    ("#1D4ED8", "#FFFFFF", "blue-700 as secondary-foreground text", 4.5),
    ("#1D4ED8", "#EDF1F7", "blue-700 on secondary bg", 4.5),
    ("#FFFFFF", "#1D4ED8", "white text on secondary-strong (gradient end)", 4.5),
    ("#FFFFFF", "#2563EB", "white on blue-600 (large/icons only)", 3.0),
    ("#0F766E", "#FFFFFF", "teal-700 as accent-strong text", 4.5),
    ("#0B1B4F", "#10B981", "navy ink on teal accent bg (btn-gold)", 4.5),
    ("#FFFFFF", "#0B1B4F", "white on navy (primary actions)", 4.5),
    ("#5A6B87", "#FFFFFF", "muted-foreground candidate on white", 4.5),
    ("#5A6B87", "#F5F8FD", "muted-foreground on app bg", 4.5),
    ("#93A8D4", "#101A31", "dark-mode brand lift text on dark card", 4.5),
    ("#4F7DF7", "#101A31", "dark-mode primary on dark card", 4.5),
    ("#FFFFFF", "#3B6AF0", "white on dark-mode primary", 4.5),
    ("#34D399", "#101A31", "dark-mode teal text on dark card", 4.5),
    ("#7DD3FC", "#101A31", "dark-mode sky text", 4.5),
    ("#E6F0FF", "#0B1B4F", "brand light #E6F0FF on navy (hero art)", 4.5),
    ("#0B1B4F", "#E6F0FF", "navy ink on light-blue brand bg", 4.5),
    ("#047857", "#FFFFFF", "emerald-600 current for comparison", 4.5),
]

for fg, bg, note, need in pairs:
    r = ratio(fg, bg)
    print(f"{'PASS' if r >= need else 'FAIL'}  {r:5.2f}:1  (need {need})  {fg} on {bg}  — {note}")
