-- ============================================================
-- AlNokhba — دور النسخ الاحتياطي (قراءة فقط)
-- انسخ الكود ده كله والصقه في: Supabase → SQL Editor → Run
-- ------------------------------------------------------------
-- بيعمل حساب backup_reader:
--   ✓ يقدر يقرا كل الجداول (للنسخ الاحتياطي بس)
--   ✗ مينوعه أي كتابة — حتى لو كلمة السر اتسرّبت مستحيل يعدّل حاجة
--   ✗ مينوعه يشوف مخططات النظام (auth/storage غير public)
-- ============================================================

-- 1) لو الدور موجود من قبل، نبدأ من نضيف
DROP ROLE IF EXISTS backup_reader;

-- 2) إنشاء الدور بكلمة سر قوية (مولّدة عشوائياً — متغيّرش منها)
CREATE ROLE backup_reader
  LOGIN
  PASSWORD '689c5ebebfc9a398f7487f6a'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 3) صلاحية القراءة فقط على السكيما العام
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;

-- 4) أي جداول جديدة في المستقبل تاخد قراءة تلقائياً
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;

-- 5) تأكيد
SELECT
  rolname     AS "الدور",
  rolcanlogin AS "يدخل؟",
  rolsuper    AS "سوبر؟",
  (SELECT count(*) FROM pg_tables t
   WHERE schemaname = 'public'
     AND has_table_privilege('backup_reader',
         '"' || t.schemaname || '"."' || t.tablename || '"', 'SELECT')) AS "جداول مقدر يقراها"
FROM pg_roles WHERE rolname = 'backup_reader';

-- ============================================================
-- النتيجة المتوقعة: صف واحد — backup_reader / t / f / 61+
-- بعد التشغيل الناجح ابعتلي «Project Reference» بتاع مشروعك
-- (من رابط المتصفح في Supabase: supabase.com/dashboard/project/[الجزء-ده])
-- ============================================================
