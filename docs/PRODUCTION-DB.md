# قاعدة البيانات الإنتاجية — PostgreSQL على Vercel (spec §10)

المشروع شغال محليًا بـ SQLite (`db/custom.db`) — وده مقصود للتطوير السريع.
للإنتاج على Vercel، السكيما نفسها بالظبط بتشتغل على PostgreSQL. العلاقة بين
النسختين:

| | التطوير المحلي | الإنتاج (Vercel) |
|---|---|---|
| السكيما | `prisma/schema.prisma` | `prisma/schema.postgres.prisma` (مولّدة آليًا) |
| المزود | SQLite | PostgreSQL |
| الرابط | `DATABASE_URL=file:../db/custom.db` | `DATABASE_URL=postgresql://...` (Env في Vercel) |
| العميل | `@prisma/client` الافتراضي | `generated/prisma-pg` |

## خطوات النشر

### 1) جهّز قاعدة PostgreSQL
أي مزود متوافق (Neon / Supabase / Vercel Postgres). خد Connection String
(`postgresql://user:pass@host/db?sslmode=require`).

### 2) أنشئ الجداول
```bash
DATABASE_URL="postgresql://... " npx prisma db push --schema prisma/schema.postgres.prisma
# أو اعمل SQL migration من غير ما تشغّل حاجة:
DATABASE_URL="postgresql://..." npx prisma migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.postgres.prisma --script > prisma/migrations/0001_init.sql
```

### 3) انقل بياناتك الحالية (اختياري — لو عايز السنتر الحالي بنفس بياناته)
```bash
npx prisma generate --schema prisma/schema.postgres.prisma   # عميل pg في generated/prisma-pg
npx tsx scripts/migrate_sqlite_to_postgres.ts "postgresql://..." 
```
السكريبت إضافي بس: `skipDuplicates` — مفيش مسح ولا استبدال، والـ IDs بتنقل زي ما هي.

### 4) على Vercel
- Environment Variables:
  - `DATABASE_URL` = رابط PostgreSQL (إجباري)
- `prisma generate` بيشتغل في Build (أضف في `package.json` لو حابب:
  `"build": "prisma generate && next build ..."`).
- لو محتاج عميل pg في runtime، غيّر الـ import في `src/lib/db.ts` لعميل
  `generated/prisma-pg` وقت البناء الإنتاجي (مخطط التبديل موضح تحت).

## قواعد ثابتة
- ممنوع credentials في الكود — كله Environment Variables (spec §10).
- ممنوع مسح أو إعادة إنشاء بيانات إنتاجية بأي سكريبت — أي عملية زرع بيانات
  هي **إضافة فقط** (`skipDuplicates`).
- `schema.postgres.prisma` ملف مولّد: عدّل `schema.prisma` الأساسي ثم
  `python3 scripts/build_postgres_schema.py`.

## تبديل `src/lib/db.ts` للإنتاج (نمط مقترح)
```ts
// وقت البناء الإنتاجي فقط — بدل الافتراضي:
import { PrismaClient } from "../generated/prisma-pg";
export const db = new PrismaClient();
```
(سيبها SQLite محليًا زي ما هي — التبديل بيتم بمتغير بناء أو ملف db.ts.bpg
في pipeline الإنتاج، مش بتعديل يدوي كل مرة.)
