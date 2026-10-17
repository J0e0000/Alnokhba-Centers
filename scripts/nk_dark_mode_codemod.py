#!/usr/bin/env python3
"""Codemod v2 (per-segment): add dark-mode counterparts to status chip class strings.

Safer than v1: operates on each double-quoted string segment independently,
so multi-string lines (ternaries, object literals, onClick handlers) get the
dark classes appended to the SAME segment that carries the light token —
never to a neighboring string (ViewId, title, aria-label, Arabic text...).

Rules:
- Only segments that look like Tailwind class lists (match the light token,
  no Arabic characters, no space-separated CJK, not inside title=/aria-label=/placeholder=).
- Skip segments that already contain any dark: class (hands-off policy).
- Light appearance preserved byte-for-byte; only dark: tokens appended.
"""
import re
import sys

LIGHT_TOKENS = [
    # (pattern, dark replacement)
    (r"\bbg-(emerald|amber|rose|sky|orange)-50(/\d+)?\b", lambda m: f"dark:bg-{m.group(1)}-950/40"),
    (r"\bborder-(emerald|amber|rose|sky|orange)-200\b", lambda m: f"dark:border-{m.group(1)}-800/60"),
    (r"\bborder-(emerald|amber|rose|sky|orange)-300\b", lambda m: f"dark:border-{m.group(1)}-700/60"),
    (r"\btext-(emerald|sky|orange)-700\b", lambda m: f"dark:text-{m.group(1)}-300"),
    (r"\btext-amber-700\b", lambda m: "dark:text-amber-300"),
    (r"\btext-amber-800\b", lambda m: "dark:text-amber-200"),
    (r"\btext-sky-800\b", lambda m: "dark:text-sky-200"),
    (r"\btext-rose-600\b", lambda m: "dark:text-rose-400"),
    (r"\btext-rose-700\b", lambda m: "dark:text-rose-300"),
]

ANY_LIGHT = re.compile(r"(bg|border|text)-(emerald|amber|rose|sky|orange)-")
ARABIC = re.compile(r"[\u0600-\u06FF]")
ATTR_PREFIX = re.compile(r'(?:title|aria-label|placeholder|alt|label|value|key|id|href|src|msg|message|text|label)\s*=\s*"$')

def dark_for_segment(seg: str) -> str | None:
    if "dark:" in seg:
        return None
    if ARABIC.search(seg):
        return None
    if not ANY_LIGHT.search(seg):
        return None
    additions = []
    for pattern, mk in LIGHT_TOKENS:
        m = re.search(pattern, seg)
        if not m:
            continue
        dark = mk(m)
        if dark.split(":", 1)[1] in seg:
            continue
        additions.append(dark)
    # de-dup preserving order
    seen, uniq = set(), []
    for a in additions:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    return (" " + " ".join(uniq)) if uniq else None

def process(path: str) -> int:
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    changed = 0
    for i, line in enumerate(lines):
        if "dark:" in line:
            continue
        if not ANY_LIGHT.search(line):
            continue
        # split into double-quoted segments, rebuild line
        out = []
        pos = 0
        seg_changed = False
        for m in re.finditer(r'"([^"\n]*)"', line):
            seg = m.group(1)
            # skip attribute strings (title="..." etc.) — the quote is preceded by attr=
            start = m.start()
            prefix = line[max(0, start - 20):start]
            if ATTR_PREFIX.search(prefix):
                out.append(line[pos:m.end()])
                pos = m.end()
                continue
            extra = dark_for_segment(seg)
            if extra:
                out.append(line[pos:m.start()] + '"' + seg + extra + '"')
                pos = m.end()
                seg_changed = True
            else:
                out.append(line[pos:m.end()])
                pos = m.end()
        out.append(line[pos:])
        if seg_changed:
            lines[i] = "".join(out)
            changed += 1
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    return changed

if __name__ == "__main__":
    total = 0
    for p in sys.argv[1:]:
        n = process(p)
        print(f"{p}: {n} lines patched")
        total += n
    print(f"TOTAL: {total}")
