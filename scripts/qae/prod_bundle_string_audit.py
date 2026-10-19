#!/usr/bin/env python3
"""Systematic deployment- freshness audit:
compare Arabic string literals in client components at HEAD vs the
production /app JS bundle, to detect ANY feature missing from prod."""
import glob, os, re, sys

PROD_DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/prod_js_app"
SRC = "/home/z/my-project/src"

# 1) load prod bundle text
prod_text = ""
for f in glob.glob(os.path.join(PROD_DIR, "*.js")):
    prod_text += open(f, encoding="utf-8", errors="ignore").read()

# 2) collect Arabic string literals from client tsx files
str_re = re.compile(r'"([^"\\\n]{6,200})"')
ar_re = re.compile(r"[\u0600-\u06FF]")
missing_by_file = {}
checked = 0
for path in sorted(glob.glob(f"{SRC}/components/nokhba/*.tsx") + glob.glob(f"{SRC}/app/**/*.tsx", recursive=True)):
    src_txt = open(path, encoding="utf-8", errors="ignore").read()
    # only client-side code ships in the bundle; server pages' literals are SSR HTML
    is_client = '"use client"' in src_txt[:200]
    for m in str_re.finditer(src_txt):
        s = m.group(1)
        if not ar_re.search(s):
            continue
        # skip imports, css-ish, keys
        if s.startswith("@/") or s.startswith("./") or re.match(r"^(w-|h-|flex|grid|text-|bg-|border|p[xytrbl]?-|m[xytrbl]?-|gap-|rounded|space-|items-|justify-|font-|shadow|animate)", s):
            continue
        checked += 1
        if s not in prod_text:
            missing_by_file.setdefault(path.replace(SRC + "/", ""), []).append(s)

print(f"literals checked: {checked} | files with missing literals: {len(missing_by_file)}")
for f, strs in sorted(missing_by_file.items()):
    print(f"\n== {f} — {len(strs)} missing ==")
    for s in strs[:8]:
        print("   •", s[:90])
