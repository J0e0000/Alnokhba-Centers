#!/usr/bin/env python3
"""توليد أيقونات PWA لنخبة سنترز — مربع أخضر بحواف دائرية + علامة QR مبسطة."""
from PIL import Image, ImageDraw

GREEN = (14, 159, 110, 255)      # #0E9F6E — لون النخبة
WHITE = (255, 255, 255, 255)

def make_icon(size: int, path: str, maskable: bool = False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # maskable icons تملأ المساحة كاملة (بدون شفافية على الحواف)
    if maskable:
        d.rectangle([0, 0, size, size], fill=GREEN)
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=GREEN)

    # علامة QR مبسطة: 3 مربعات صغيرة بالزوايا + نقاط
    u = size / 10  # وحدة القياس
    pad = 0 if maskable else 1.6 * u
    def corner(cx, cy):
        x0, y0 = pad + cx * u, pad + cy * u
        d.rounded_rectangle([x0, y0, x0 + 2.4 * u, y0 + 2.4 * u], radius=int(0.35 * u), outline=WHITE, width=max(2, int(0.42 * u)))
        d.rectangle([x0 + 0.85 * u, y0 + 0.85 * u, x0 + 1.55 * u, y0 + 1.55 * u], fill=WHITE)
    corner(0.4, 0.4)   # أعلى يسار
    corner(6.6, 0.4)   # أعلى يمين
    corner(0.4, 6.6)   # أسفل يسار
    # نقاط متناثرة تمثل بيانات QR
    dots = [(7.0, 6.8), (8.2, 7.6), (7.0, 8.4), (8.4, 6.4), (5.4, 5.6), (6.4, 4.6), (4.6, 7.2), (5.8, 8.2)]
    for cx, cy in dots:
        x0, y0 = pad + cx * u, pad + cy * u
        d.rounded_rectangle([x0, y0, x0 + 0.85 * u, y0 + 0.85 * u], radius=int(0.2 * u), fill=WHITE)

    img.save(path, "PNG")
    print(f"saved {path} ({size}x{size})")

make_icon(192, "public/icon-192.png")
make_icon(512, "public/icon-512.png")
make_icon(512, "public/icon-maskable-512.png", maskable=True)
