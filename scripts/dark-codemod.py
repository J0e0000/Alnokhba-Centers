#!/usr/bin/env python3
"""Codemod: إضافة متغيرات dark: للألوان الفاتحة الهاردكودة في مكونات تطبيق السنتر فقط.

قواعد الأمان:
- bg-white → bg-card (نفس القيمة في الفاتح: --card=#ffffff — تغيير محايد تمامًا في الفاتح)
- bg-white/N و bg-white-N مستثناة (طبقات بيضاء على خلفيات ملونة — بتشتغل في الوضعين)
- توكن-level مع lookahead يمنع التداخل مع / أو - أو أرقام
- idempotent: لو التوكن متبوع بـ dark: مباشرة مش بيتلمس تاني
- ملفات الطباعة (print.tsx) مستثادة تمامًا — الطباعة فاتحة دايمًا
"""
import re, sys, pathlib

ROOT = pathlib.Path("/home/z/my-project/src/components/nokhba")

# الملفات المستهدفة — تطبيق السنتر التشغيلي فقط
TARGETS = [
    "shell.tsx", "dashboard.tsx", "session-live.tsx", "scan.tsx",
    "payments-view.tsx", "students.tsx", "student-profile.tsx", "schedule.tsx",
    "groups.tsx", "books.tsx", "message-queue.tsx", "accounting.tsx",
    "reports.tsx", "settings.tsx", "emergency.tsx", "approvals.tsx",
    "shared.tsx", "cards.tsx", "staff-bell.tsx", "student-search.tsx",
    "command-palette.tsx", "demo-card.tsx", "qr-scanner.tsx",
    "receipt-actions.tsx", "help.tsx", "tour.tsx", "whatsapp-button.tsx",
]

# (توكن فاتح، مكافئ الدارك)
MAP = []
for c in ["emerald", "amber", "rose", "sky", "red", "orange", "lime", "green"]:
    MAP += [
        (f"bg-{c}-50", f"bg-{c}-950/50"),
        (f"bg-{c}-100", f"bg-{c}-950/70"),
        (f"border-{c}-200", f"border-{c}-900"),
        (f"border-{c}-300", f"border-{c}-800"),
        (f"text-{c}-700", f"text-{c}-300"),
        (f"text-{c}-800", f"text-{c}-200"),
        (f"text-{c}-600", f"text-{c}-400"),
        (f"text-{c}-500", f"text-{c}-400"),
    ]
MAP += [
    ("bg-slate-50", "bg-slate-900/50"),
    ("bg-slate-100", "bg-slate-900/70"),
    ("bg-gray-50", "bg-gray-900/50"),
    ("bg-gray-100", "bg-gray-900/70"),
    ("border-slate-200", "border-slate-800"),
    ("border-slate-300", "border-slate-700"),
    ("text-slate-600", "text-slate-300"),
    ("text-slate-500", "text-slate-400"),
    ("text-gray-600", "text-gray-300"),
    ("text-gray-500", "text-gray-400"),
]

def tokenize_re(token: str) -> re.Pattern:
    # توكن كامل: مش مسبوق بحرف/رقم/- وغير متبوع بـ / أو حرف أو رقم (يمنع bg-white/20 و bg-emerald-500)
    return re.compile(r"(?<![\w/-])" + re.escape(token) + r"(?![\w/])")

def run(path: pathlib.Path) -> int:
    src = path.read_text(encoding="utf-8")
    orig = src
    total = 0

    # 1) bg-white → bg-card (المكافئ الفاتح مطابق 100%)
    src, n = tokenize_re("bg-white").subn("bg-card", src)
    total += n

    # 2) التوكنات الملونة → نفس التوكن + dark: بعده
    for light, dark in MAP:
        pat = tokenize_re(light)
        out = []
        idx = 0
        added = 0
        for m in pat.finditer(src):
            end = m.end()
            # idempotency: التوكن متبوع مباشرة بـ f" dark:{dark}"؟ خذّله
            rest = src[end:end + len(dark) + 7]
            if rest.startswith(f" dark:{dark}"):
                continue
            out.append(src[idx:end])
            out.append(f" dark:{dark}")
            idx = end
            added += 1
        out.append(src[idx:])
        src = "".join(out)
        total += added

    # 3) حدود color-mix مع أبيض (حدود براند على كروت بيضاء)
    #    border-[color-mix(in_srgb,var(--c-primary)_NN%,white)] → + dark:border-[...(_NN+20%,#0d1420)]
    def mix_border(m: re.Match) -> str:
        tok = m.group(0)
        pct = int(m.group(1))
        dpct = min(92, pct + 22)
        return f"{tok} dark:border-[color-mix(in_srgb,var(--c-primary)_{dpct}%,#0d1420)]"
    src, n = re.subn(
        r"border-\[color-mix\(in_srgb,var\(--c-primary\)_(\d+)%,white\)\](?!\s*dark:)",
        mix_border, src)
    total += n

    if src != orig:
        path.write_text(src, encoding="utf-8")
    return total

grand = 0
for name in TARGETS:
    p = ROOT / name
    if not p.exists():
        print(f"skip (missing): {name}")
        continue
    n = run(p)
    grand += n
    print(f"{n:4d}  {name}")
print(f"---- total replacements: {grand}")
