# قاعدة البيانات الإنتاجية — Vercel + PostgreSQL

المشروع شغال محليًا بـ SQLite (`db/custom.db`) — وده مقصود للتطوير السريع.
للإنتاج: نفس الكود بالظبط بيشتغل على PostgreSQL من غير أي تغيير في الاستيرادات.

| | التطوير المحلي | الإنتاج (Vercel) |
|---|---|---|
| السكيما | `prisma/schema.prisma` | `prisma/schema.postgres.prisma` (مولّدة آليًا) |
| المزود | SQLite | PostgreSQL |
| الرابط | `DATABASE_URL=file:../db/custom.db` | `DATABASE_URL=postgresql://...` (Env في Vercel) |
| العميل | `@prisma/client` الافتراضي | `@prisma/client` نفسه — بيتولّد من سكيما pg وقت البناء |

**آلية الاختيار أوتوماتيك:** `scripts/vercel-build.sh` (عن طريق `vercel.json`)
بيكتب `DATABASE_URL` — لو بدأ بـ `postgres` بيولّد العميل من سكيما pg ويعمل
`db push` (إنشاء الجداول أول مرة، وتحديثات إضافية بس — أي تغيير تدميري
بيفشل البناء بدل ما يمسح بيانات). غير كده: السكيما العادية.

## خطوات النشر (5 دقائق)

### 1) اعمل قاعدة PostgreSQL — اختار واحد:

**Vercel Postgres (الأسهل — كله في مكان واحد):**
1. https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FJ0e0000%2FAlnokhba-Centers&env=DATABASE_URL&project-name=alnokhba-centers
2. بعد الاستيراد: تبويب **Storage** → **Create Database** → **Postgres (Neon)**
3. اربطها بالمشروع — `DATABASE_URL` بتتضاف أوتوماتيك → **Deploy**

**Supabase (باكند كامل: DB + Auth + Storage + Dashboard):**
1. https://supabase.com/dashboard → New project (منطقة قريبة: eu-central)
2. **Project Settings → Database → Connection string → URI**
3. اختار **Transaction pooler** (بورت 6543) وزوّد عليها `?pgbouncer=true&connection_limit=1`
4. انسخ الرابط — ده اللي هيتحط في `DATABASE_URL`

**Neon (مخصص لـ serverless):**
1. https://neon.tech → Create project
2. انسخ الـ **Pooled connection** string

### 2) انشر على Vercel
- ادخل على لينك الـ clone فوق (أو https://vercel.com/new واختار `Alnokhba-Centers`)
- في **Environment Variables** ضيف:
  - `DATABASE_URL` = رابط PostgreSQL بتاعك (إجباري)
- اضغط **Deploy** — أول بناء بيعمل كل الجداول أوتوماتيك

### 3) انقل بياناتك الحالية (اختياري — السنتر الحالي بنفس بياناته)
من أي جهاز عليه المشروع (أو ابعت الرابط للمطور):
```bash
npx tsx scripts/migrate_sqlite_to_postgres.ts "postgresql://..."
```
السكريبت إضافي بس (`skipDuplicates`): مفيش مسح ولا استبدال، والـ IDs بتنقل زي ما هي.
عدد الموديلز بيتحدد أوتوماتيك من السكيما (DMMF) والترتيب FK-safe.

## قواعد ثابتة
- ممنوع credentials في الكود — كله Environment Variables.
- ممنوع مسح أو إعادة إنشاء بيانات إنتاجية بأي سكريبت — الزرع **إضافة فقط**.
- `schema.postgres.prisma` ملف مولّد: عدّل `prisma/schema.prisma` الأساسي ثم
  `python3 scripts/build_postgres_schema.py`.

## ملاحظات تشغيلية
- Supabase + serverless لازم pooler (بورت 6543) + `?pgbouncer=true&connection_limit=1`
  عشان الـ Prisma connections متنفدش.
- أول deploy بعد الربط: `vercel-build.sh` بيعمل `db push` → كل الجداول بتتعمل لوحدها.
- لو عايز تشوف بياناتك: Supabase Table Editor أو `npx prisma studio` محليًا على نفس الرابط.
