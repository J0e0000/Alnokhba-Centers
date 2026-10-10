#!/usr/bin/env python3
"""Wire requireModule() gates into API routes (entitlement enforcement).
Inserts after each handler's auth guard, per (file, method) config.
Idempotent: skips if requireModule already present in that handler block."""
import re, os

ROOT = "/home/z/my-project/src/app/api"

# file-rel-path -> (module, {methods to gate})
CONFIG = {
    "payments/route.ts": ("finance", {"GET", "POST"}),
    "accounting/route.ts": ("finance", {"GET", "POST", "PATCH", "DELETE"}),
    "exams/route.ts": ("exams", {"GET", "POST"}),
    "exams/[id]/route.ts": ("exams", {"GET", "POST", "PATCH", "DELETE", "PUT"}),
    "quizzes/route.ts": ("exams", {"GET", "POST"}),
    "quizzes/[id]/route.ts": ("exams", {"GET", "POST", "PATCH", "DELETE", "PUT"}),
    "assignments/route.ts": ("assignments", {"GET", "POST"}),
    "assignments/[id]/route.ts": ("assignments", {"GET", "POST", "PATCH", "DELETE", "PUT"}),
    "books/route.ts": ("books", {"GET", "POST", "PATCH", "DELETE", "PUT"}),
    "reports/route.ts": ("reports", {"GET", "POST"}),
    "zaki/route.ts": ("ai_agent", {"GET", "POST"}),
    "agent/message/route.ts": ("ai_agent", {"POST"}),
    "agent/transcribe/route.ts": ("ai_agent", {"POST"}),
    "agent/speak/route.ts": ("ai_agent", {"POST"}),
    "notify/route.ts": ("communications", {"POST"}),
    "students/route.ts": ("students", {"POST"}),  # GET stays open (attendance roster needs it)
    "students/[id]/route.ts": ("students", {"PATCH", "DELETE", "PUT", "POST"}),
    "students/bulk/route.ts": ("students", {"POST"}),
}

GUARD_RE = re.compile(r"(const user = await require(?:CenterUser|Manager|User)\(\);)")

total = 0
for rel, (module, methods) in CONFIG.items():
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        print(f"MISSING: {rel}")
        continue
    src = open(path).read()
    # split into handler blocks by `export const <METHOD> = handler`
    out = []
    pos = 0
    count = 0
    for m in re.finditer(r"export const (\w+) = handler", src):
        method = m.group(1)
        block_start = m.start()
        out.append(src[pos:block_start])
        # find the block extent: until next `export const` or EOF
        nxt = re.search(r"export const \w+ = handler", src[m.end():])
        block_end = m.end() + nxt.start() if nxt else len(src)
        block = src[block_start:block_end]
        if method in methods and "requireModule(" not in block and GUARD_RE.search(block):
            block = GUARD_RE.sub(
                lambda g: g.group(1) + f'\n  await requireModule(user.centerId, "{module}");',
                block, count=1,
            )
            count += 1
        out.append(block)
        pos = block_end
    out.append(src[pos:])
    new = "".join(out)
    if count and 'from "@/lib/entitlements"' not in new:
        # add import after the last @/lib import line
        imp = f'import {{ requireModule }} from "@/lib/entitlements";\n'
        anchor = re.search(r'(import[^\n]*from "@/lib/(?:audit|api|auth|normalize)";\n)', new)
        if anchor:
            new = new[:anchor.end()] + imp + new[anchor.end():]
        else:
            new = imp + new  # fallback: top
    open(path, "w").write(new)
    total += count
    print(f"{rel}: {count} handler(s) gated with {module}")
print(f"TOTAL: {total} handlers gated")
