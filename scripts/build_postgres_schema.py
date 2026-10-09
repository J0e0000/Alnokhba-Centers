#!/usr/bin/env python3
"""Regenerate prisma/schema.postgres.prisma from prisma/schema.prisma.

Single source of truth = prisma/schema.prisma (SQLite, local dev).
This script derives the production PostgreSQL variant:
  - datasource provider: sqlite -> postgresql
  - generator client: default output (so on Vercel, `@prisma/client`
    resolves to the postgres client with zero import changes)

Usage: python3 scripts/build_postgres_schema.py
"""
import re
import sys

SRC = "prisma/schema.prisma"
DST = "prisma/schema.postgres.prisma"

HEADER = """// ⚠️ GENERATED FILE — do not edit by hand.
// Regenerated from prisma/schema.prisma by scripts/build_postgres_schema.py
// (production variant — Vercel + PostgreSQL)
// The generator uses the DEFAULT output so that `@prisma/client` resolves to
// the postgres client during Vercel builds without any import switching.

"""


def main() -> int:
    with open(SRC, "r", encoding="utf-8") as f:
        schema = f.read()

    # 1) datasource provider swap (only inside the datasource block)
    schema = re.sub(
        r'(datasource\s+db\s*\{[^}]*?provider\s*=\s*")sqlite(")',
        r"\1postgresql\2",
        schema,
        count=1,
    )

    # 2) normalize the generator block: drop any custom `output` so the
    #    generated client lands in node_modules/@prisma/client (default).
    def fix_generator(m: "re.Match[str]") -> str:
        block = m.group(0)
        block = re.sub(r"\n\s*output\s*=\s*\"[^\"]*\"", "", block)
        return block

    schema = re.sub(
        r"generator\s+client\s*\{[^}]*\}", fix_generator, schema, count=1
    )

    # 3) أعمدة "معلقة المزامنة" — موجودة في سكيما SQLite المحلية بس مش متزامنة
    #    بعد على قاعدة الإنتاج (db push بيتعطل أحيانًا على pgbouncer وقت البيلد).
    #    العمود بيتشال من نسخة الإنتاج لحد ما المزامنة اليدوية تتعمل — عشان
    #    العميل المولّد ميفشّلش كل query بتعمل full-row select (زي GET /api/settings).
    #    لإعادة تفعيل العمود: اعمل db push يدوي (docs/PRODUCTION-DB.md) وشيل السطر من تحت.
    PENDING_COLUMNS = [
        "agentSttModel",  # STT model setting — pending production DB sync
    ]
    removed = []
    for col in PENDING_COLUMNS:
        pat = re.compile(rf"^\s*{col}\s+String\?\s*(//[^\n]*)?\n", re.MULTILINE)
        schema, n = pat.subn("", schema)
        if n:
            removed.append(col)

    with open(DST, "w", encoding="utf-8") as f:
        f.write(HEADER + schema)

    out = re.search(r"generator client \{[^}]*output", schema)
    print(f"✔ wrote {DST}")
    print(f"  provider = postgresql : {'YES' if 'postgresql' in schema else 'NO'}")
    print(f"  custom output removed : {'YES' if not out else 'NO — CHECK!'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
