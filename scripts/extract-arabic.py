#!/usr/bin/env python3
"""استخراج النصوص العربية من الواجهة لمراجعة الأخطاء الإملائية"""
import re
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project/src")

# كلمات شائعة مكتوبة غلط → الصواب (نتحقق منها + غيرها بالعين)
files = sorted(ROOT.glob("components/nokhba/**/*.tsx")) + sorted(
    ROOT.glob("components/nokhba/**/*.ts")
) + sorted(ROOT.glob("app/api/**/*.ts")) + sorted(ROOT.glob("lib/*.ts"))

arabic = re.compile(r"[\u0600-\u06FF]")
# نصوص داخل علامات تنصيص أو قوالب
str_re = re.compile(r'"([^"\n]*[\u0600-\u06FF][^"\n]*)"|' + "`([^`\n]*[\u0600-\u06FF][^`\n]*)`" + "|'([^'\n]*[\u0600-\u06FF][^'\n]*)'")
# نصوص JSX بين > و <
jsx_re = re.compile(r">([^<>\n{}]*[\u0600-\u06FF][^<>\n{}]*)<")

out = []
for f in files:
    try:
        lines = f.read_text(encoding="utf-8").splitlines()
    except Exception:
        continue
    for i, line in enumerate(lines, 1):
        # تجاهل التعليقات الطويلة التقنية (نتحقق منها يدويًا لو لزم)
        matches = []
        for m in str_re.finditer(line):
            s = next(x for x in m.groups() if x is not None)
            matches.append(s)
        for m in jsx_re.finditer(line):
            matches.append(m.group(1))
        for s in matches:
            s = s.strip()
            if len(s) >= 2 and arabic.search(s):
                out.append((str(f).replace(str(ROOT) + "/", ""), i, s))

for f, i, s in out:
    print(f"{f}:{i}\t{s}")
print(f"\n# total: {len(out)}", file=sys.stderr)
