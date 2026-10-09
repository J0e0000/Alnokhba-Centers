# قاعدة البيانات الإنتاجية — Vercel + PostgreSQL

المشروع شغال محليًا بـ SQLite (`db/custom.db`) — وده مقصود للتطوير السريع.
للإنتاج: نفس الكود بالظبط بيشتغل على PostgreSQL من غير أي تغيير في الاستيرادات.

## 🚀 النشر الجديد (قاعدة قديمة اتحذت — deployment جديد من الصفر)

لو الموقع اتحوّل لنشر جديد والقاعدة القديمة اتحذت، ده الطريق الكامل (10 دقائق):

1. **اعمل قاعدة PostgreSQL جديدة** — Neon / Supabase / Vercel Postgres (التفاصيل تحت).
2. **في مشروع Vercel الجديد** → Settings → Environment Variables:
   - `DATABASE_URL` = رابط القاعدة الجديدة (**إجباري** — بورت pooler للسيرفرلس).
   - اختياري حسب الحاجة: `NEXT_PUBLIC_SITE_URL` (الدومين الجديد)،
     `NOKHBA_PV_SECRET` (قوي وعشوائي)، `GOOGLE_SITE_VERIFICATION`.
   - متغيرات زكي (LLM/STT) **اختيارية** — بتتخزن جوه إعدادات السنتر في الداتابيز نفسها.
3. **Deploy** — البناء بيعمل `prisma db push` أوتوماتيك على القاعدة الفاضية
   = كل الجداول بتتعمل لوحدها (إضافي فقط، مفيش مسح بيانات).
4. **انقل البيانات** من قاعدة التطوير المحلية (نفس البيانات اللي كانت شغالة):
   ```bash
   npx tsx scripts/migrate_sqlite_to_postgres.ts "postgresql://...الرابط-الجديد"
   ```
   السكريبت إضافي فقط (`skipDuplicates`) — الـ IDs بتتنقل زي ما هي، مفيش أي مسح.
5. **بعد الترحيل لازم إعادة إدخال مفتاح Groq** — مفتاح الموديل كان محفوظ في
   إعدادات السنتر في القاعدة القديمة (اتحذت). ادخل بإ حساب المدير →
   الإعدادات → موديل زكي → الصق المفتاح (نفس المفتاح القديم gsk_...) → حفظ →
   اختبار الاتصال. من غير الخطوة دي زكي بيشتغل بالمخ الحتمي بس (من غير موديل).

> ملاحظة: لو محتاج تتحقق إن القاعدة اتزرعت صح: `npx prisma studio` على نفس
> الرابط، أو سجل دخول بحساب المدير — لو الدخول نجح الترحيل تمام.

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

## ⚠️ قاعدة إجبارية قبل أي deploy فيه تغيير سكيما
**أي تعديل على `prisma/schema.prisma` لازم يعدي `prisma/schema.postgres.prisma` معاه:**
```bash
python3 scripts/build_postgres_schema.py
```
البناء على Vercel بيولّد الـ Prisma client **من `schema.postgres.prisma`** — لو الملف
اتقديم عن الأساسي، الـ client المنشور مش هيعرف الموديلز الجديدة وكل endpoint بيلمسها
هيرجّع 500 «حصل خطأ غير متوقع في السيرفر» (ده اللي حصل فعليًا مع موديلز
Capabilities/AttendanceEvent/CheckInAttempt — 6 جداول ناقصة في الإنتاج).

## آلية مزامنة السكيما (بعد درس 10-03)
- `vercel-build.sh` بيعمل `prisma db push` بعد الـ generate — **إضافي فقط**
  (من غير `--accept-data-loss` فأي تغيير تدميري بيفشل بدل ما يلمس البيانات)
  وبتوقيت حماية 120ث (DDL فوق transaction pooler ممكن يعلق — لو فشل البناء
  بيكمل عادي والجداول تتظبط يدويًا).
- المسار اليدوي الأضمن (session pooler — بورت 5432):
  ```bash
  DATABASE_URL="<session-pooler-url>" npx prisma db push \
    --schema=prisma/schema.postgres.prisma --skip-generate
  ```

## ملاحظات تشغيلية
- Supabase + serverless لازم pooler (بورت 6543) + `?pgbouncer=true&connection_limit=1`
  عشان الـ Prisma connections متنفدش.
- أول deploy بعد الربط: `vercel-build.sh` بيعمل `db push` → كل الجداول بتتعمل لوحدها.
- لو عايز تشوف بياناتك: Supabase Table Editor أو `npx prisma studio` محليًا على نفس الرابط.
- عبارات DDL مفردة (autocommit) شغالة على transaction pooler عادي — اللي بيعلق هو
  الـ interactive transactions والمجموعات؛ خد ده في الاعتبار لو عملت سكريبت صيانة.
