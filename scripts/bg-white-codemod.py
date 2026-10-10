#!/usr/bin/env python3
"""bg-white -> bg-card codemod: بيخلي الأسطح البيضا تتبع الثيم في الدارك (كارت #131c2b).
- بيستبدل التوكن الوحيد bg-white بس (مش bg-white/60 ولا bg-white/25)
- بيتخطى print.tsx (الطباعة لازم تفضل بيضا)
- بيطبع ملخص لكل ملف
"""
import re, sys, pathlib

ROOT = pathlib.Path("/home/z/my-project/src/components")
# token: bg-white not followed by / or - or alnum  (catches variant prefixes too: hover:bg-white)
PAT = re.compile(r"(?<![\w-])bg-white(?![/\w-])")
EXCLUDE = {"print.tsx"}

total = 0
files_changed = []
for tsx in ROOT.rglob("*.tsx"):
    if tsx.name in EXCLUDE:
        continue
    src = tsx.read_text(encoding="utf-8")
    n = len(PAT.findall(src))
    if n == 0:
        continue
    out = PAT.sub("bg-card", src)
    tsx.write_text(out, encoding="utf-8")
    total += n
    files_changed.append((str(tsx.relative_to(ROOT.parent)), n))

for f, n in sorted(files_changed, key=lambda x: -x[1]):
    print(f"{n:4d}  {f}")
print(f"TOTAL: {total} replacements in {len(files_changed)} files")
