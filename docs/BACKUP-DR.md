# النسخ الاحتياطي واستمرارية الأعمال (Backup / DR) — مرحلة 2

> آخر تحديث: 2026-10-21 | الحالة: جاهز — النسخة الفعلية من الإنتاج محتاجة رابط قراءة فقط (تحت)

## الخلاصة التنفيذية

| | |
|---|---|
| **أداة النسخ** | `npm run backup:pg` — dump منطقي (SCHEMA + DATA) من Postgres |
| **السلامة** | جلسة `REPEATABLE READ READ ONLY` — استحالة كتابة أي حاجة على الإنتاج |
| **اختبار الاسترجاع** | `npm run backup:restore-test` — يرجّع آخر dump في PGlite ويقارن كل جدول |
| **اختبار ذاتي كامل** | `npm run backup:selftest` — سكريبت + سيرفر Postgres وهمي + استرجاع + مقارنة قيم |
| **مكان الملفات** | `backup/pg/nokhba-pg-<تاريخ>.sql` + `.sha256` + `latest-status.json` |
| **الخصوصية** | `backup/` في `.gitignore` — الملفات صلاحيتها 600 وبتفضل على الجهاز |

## 1) إزاي تاخد نسخة

```bash
# من رابط مباشر:
npx tsx scripts/backup/postgres-backup.mts --url "postgresql://user:pass@host:5432/db"

# أو من ملف env فيه DATABASE_URL:
npx tsx scripts/backup/postgres-backup.mts --url .env.vercel
```

السكريبت بيطلع في الآخر: عدد الجداول، عدد الصفوف، الحجم، وبصمة sha256.
ملف `backup/pg/latest-status.json` بيحتوي الميتاداتا كاملة (بيتحدّث كل تشغيلة).

**ملاحظة أمنية مهمة:** رابط الإنتاج في Vercel متخزن **Sensitive** — يعني `vercel env pull` بيرجّع
`[SENSITIVE]` بدل القيمة (ده سلوك مقصود من Vercel). عشان كده النسخة بتاخد رابط قراءة فقط من Supabase مباشرة (تحت).

## 2) قاعدة القراءة فقط (الأسلوب المعتمد)

عشان حتى لو الرابط اتسرّب يبقى مستحيل يكتب، اعمل دور (role) قراءة فقط في Supabase:

```sql
-- Supabase Dashboard → SQL Editor (بحساب المالك):
CREATE ROLE backup_reader LOGIN PASSWORD 'كلمة-سر-قوية-عشوائية';
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
```

وبعدين الرابط الشكل بتاعه:

```
postgresql://backup_reader:كلمة-السر@db.<project-ref>.supabase.co:5432/postgres
```

> البورت 5432 = اتصال مباشر (أفضل للنسخ). لو حجبه مزود الشبكة استخدم 6543 (pooler).

**التوصية:** احتفظ بالرابط ده في متغير `BACKUP_DATABASE_URL` (مش DATABASE_URL) — محلياً أو في أي مكان آمن.

## 3) اختبار الاسترجاع (يشتغل تلقائياً)

```bash
npx tsx scripts/backup/restore-test.mts                    # آخر dump
npx tsx scripts/backup/restore-test.mts backup/pg/xxx.sql  # ملف محدد
```

بيعمل:
1. تحقق sha256 للملف.
2. استرجاع كامل (SCHEMA ثم DATA ثم القيود PK/UNIQUE/FK) في **PGlite** — Postgres حقيقي in-process معزول تماماً.
3. مقارنة عدد الصفوف لكل جدول مع الميتاداتا — أي اختلاف = FAIL.
4. التأكد إن قيود FK اتبنت فعلاً (منها المرجع الذاتي للمرتجعات المالية).
5. كتابة `validated: true/false` في `latest-status.json`.

القاعدة الذهبية: **نسخة من غير اختبار استرجاع = مش نسخة احتياطية.** شغّل الاختبار بعد كل نسخة.

## 4) خطة الاسترجاع للطوارئ (DR Runbook)

السيناريو: قاعدة الإنتاج ضاعت/اتمسحت/بوظت.

1. **جهّز قاعدة جديدة**: Supabase → New project (أو نفس المشروع لو النطاق لسه شغال).
2. **استرجع الـ dump** — الملف self-contained (سكيما + بيانات + قيود):
   ```bash
   # لو pg tools متاحة:
   psql "postgresql://postgres:...@<host>:5432/postgres" -f backup/pg/nokhba-pg-XXX.sql
   # أو بنفس أداة الاسترجاع (PGlite socket server) — سكريبت الاسترجاع الكامل تحت.
   ```
3. **حدّث `DATABASE_URL`** في Vercel → Settings → Environment Variables للرابط الجديد.
4. **Redeploy** — `vercel --prod` (أو push على main).
5. **تحقق**: `curl https://<الدومين>/api/system/db-status` = `{"mode":"postgres"}` ثم دخول بحساب مدير ومراجعة
   شاشة الطلاب والخلاصات.
6. **دقائق التوقف (RTO)**: ~10-15 دقيقة. **فقدان البيانات (RPO)**: من آخر نسخة — التوصية نسخة يومية.

## 5) الجدولة المقترحة

| التكرار | الأداة | ملاحظات |
|---|---|---|
| يومي | `npm run backup:pg` + `backup:restore-test` | cron محلي أو يدوي قبل أي عملية حساسة |
| قبل كل نشر | `npm run backup:pg` | إلزامي قبل migrate/destructive change |
| أسبوعي | مراجعة `latest-status.json` | حجم + عدد صفوف + validated=true |

## 6) مستويات النسخ الثلاثة

1. **منصة (Postgres)** — `scripts/backup/postgres-backup.mts` (ده الملف) — كامل المنصة.
2. **سنتر (JSON/CSV/Excel)** — `/api/backup` من داخل التطبيق (مدير السنتر) — بيانات سنتره بس.
3. **لقطة محلية (SQLite)** — `?download=latest` — للتطوير المحلي فقط؛ في وضع Postgres بترجع رسالة إرشادية (حماية من VACUUM INTO اللي مش معناه حاجة على PG).

## 7) القيود الحالية

- [ ] **الرابط الفعلي للإنتاج مش عندي** — DATABASE_URL متخزن Sensitive في Vercel (بيترجع `[SENSITIVE]`).
      محتاجين دور `backup_reader` (القسم 2) وبعدها النسخة الأولى تتاخد فوراً.
- [ ] الجدولة الآلية (cron) لسه يدوية — ممكن نضيفها في GitHub Actions لاحقاً مع تشفير الـ dump قبل الرفع.
