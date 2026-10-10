#!/usr/bin/env python3
"""Attach img keys to key FAQ items in help-content.tsx (idempotent)."""
import re, io

P = "/home/z/my-project/src/components/nokhba/help-content.tsx"
src = io.open(P, encoding="utf-8").read()

# (unique substring of the question, img key)
MAP = [
    ("إيه الفرق بين حصة «شغالة»", "dashboard"),
    ("دوس على حصة النهاردة بيعمل إيه؟", "dashboard"),
    ("امسح كارت الطالب مش بيظهر عندي؟", "scan"),
    ("معنى الألوان بعد المسح؟", "scan"),
    ("الباقي بيتحسب إزاي؟", "payments"),
    ("الإيصال بيتطبع إزاي؟", "payments"),
    ("مفيش عندي زرار استرداد — ليه؟", "payments"),
    ("إيه اللي بيوصلي هنا؟", "approvals"),
    ("الطلب بيبان فيه إيه قبل ما أقرر؟", "approvals"),
    ("طالب مش بيظهر في القايمة؟", "student"),
    ("أطبع كارت الطالب (QR) منين؟", "student"),
    ("الرصيد الأحمر معناه إيه؟", "student"),
    ("الخزنة بتتقفل إزاي؟", "accounting"),
    ("مستحقات المدرسين؟", "accounting"),
    ("إيه نظام الطوارئ HTML؟", "emergency"),
    ("إزاي بنزّل حزمة الطوارئ؟", "emergency"),
    ("أنزل التقرير Excel؟", "reports"),
    ("أدق تقرير لأرباح الشهر؟", "reports"),
    ("الرصيد اللي شايفه صح؟", "portal"),
    ("الإشعارات دي إيه؟", "portal"),
    ("مستحقاتي بتتحسب إزاي؟", "teacher"),
    ("أقرب حصة جاية دقيقة؟", "teacher"),
    ("النظام بيشتغل على الموبايل؟", "dashboard"),
    ("أضيف مستخدم (موظف) جديد؟", "student"),
]

changed = 0
for needle, img in MAP:
    # find the FAQ item line containing the needle (line starts with "  { view:")
    lines = src.split("\n")
    for i, ln in enumerate(lines):
        if needle in ln and "view:" in ln and "q:" in ln:
            if f'img: "{img}"' in ln:
                break  # already has it
            # insert img before the closing }
            new_ln = ln.rstrip()
            assert new_ln.endswith("},")
            new_ln = new_ln[:-2] + f', img: "{img}" }},'
            lines[i] = new_ln
            src = "\n".join(lines)
            changed += 1
            break
    else:
        print(f"NOT FOUND: {needle}")

io.open(P, "w", encoding="utf-8").write(src)
print(f"patched {changed} FAQ items with images")
