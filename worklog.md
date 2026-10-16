---
Task ID: descope-financial-only
Agent: Super Z (main agent)
Task: إزالة كل الميزات الأكاديمية من النخبة سنترز — النظام يبقى حضور وغياب + مالي فقط. Teacher portal = جدول + عدد طلاب + رسالة فقط.

Work Log:
- فحص شامل: كل الجداول الأكاديمية كانت فاضية (0 rows) → الإزالة آمنة بدون فقدان بيانات
- Prisma schema: حذف 32 موديل/حقول — Quiz/QuizQuestion/QuizAttempt, Exam/ExamQuestion/ExamAttempt/ExamAnswer/ExamSecurityEvent, Assignment/AssignmentQuestion/AssignmentSubmission, SessionExam/SessionExamScore, كل موديلات Aca* (19 موديل academia), حقول SessionInstance.lessonTopic/homeworkText/videoLink, حقول Attendance.homeworkStatus/interactionPlus/interactionMinus, User.scope/acaPermissions + علاقاتها, SessionQRToken.scope
- حذف ملفات: components/academia (10 ملفات), app/academia, api/academia (15 route), lib/academia, quiz-manager, exam-manager, assignment-manager, portal/exams, portal/assignments, teacher/teaching, lib/quiz.ts, lib/exam.ts, seed-academia.ts
- حذف API routes: /api/quizzes, /api/exams, /api/assignments, /api/sessions/[id]/exam, /api/sessions/[id]/records, /api/portal/{quizzes,exams,assignments}, /api/teacher-portal/{exams,assignments,money,students}
- session-live.tsx: خط 5 مراحل → 3 مراحل (حضور/مراجعة/تقرير) — حذف InteractionStage + ExamsStage + نموذج تقرير الحصة الأكاديمي، stage key v1→v2، إزالة وضع تعديل الحصة القديمة (editPast)
- session-report.tsx: رسائل واتساب لأولياء الأمور = حضور/غياب فقط (بدون درجات/واجب/درس اليوم/فيديو)
- portal/portal.tsx: 6 تابات → 3 (رئيسية/جدولي/رسائل) — حذف PortalQuizzes بالكامل + quizAvg من التقدم
- teacher-portal.tsx: 6 تابات → 3 (رئيسية/جدولي/رسالة) — إضافة TeacherMessage + عدد الطلاب في كل حصة بالجدول (schedule API students count) — إزالة فلوسي/طلابي/امتحانات/واجبات
- جديد: POST /api/teacher-portal/message → notifyStaff(MANAGER+RECEPTIONIST) — رسالة المدرس توصل جرس الإشعارات للإدارة (خصوصية: بدون أرقام أولياء أمور)
- تنظيف lib: modules.ts (حذف exams/assignments keys), notify.ts (أنواع SCHEDULE فقط), zaki.ts (حذف ruleQuizDecline), ai/tools (حذف exams.list + quiz rows), fallback.ts, prompts, auth.ts (حذف scope), session-qr.ts (CENTERS فقط), login/seo/admin guard, seed.ts (حذف demo quiz), landing.tsx (حذف كروت Edu/QB), labels (TEACHER = جدول الحصص بس)
- DB: اكتشفت أن db/custom.db كان فاضي قبل بدء الشغل (مُسح سابقًا) → استرجعت db-backup-20261015/custom.db (43.5MB: 5000 طالب، 37488 حضور، 37002 حركة مالية) → طبقت schema الجديد عليها (الجداول الأكاديمية فاضية فيه أيضًا)
- تحقق e2e: tsc صفر أخطاء src، build نجح، كل الأكاديمية APIs = 404، فتح حصة حقيقية → حضور → شحن 78ج → عكس → إلغاء، teacher portal login/schedule counts/message delivery (4 موظفين)، student portal (رصيد + نسبة حضور بدون quizAvg)، فحص متصفح كامل للقوائم والتابات الجديدة

Stage Summary:
- النظام بقى حضور وغياب + مالي فقط — صفر ميزات أكاديمية في الكود أو الـ schema أو الواجهات
- البيانات التشغيلية سليمة 100%: 5 مستخدمين، 5000 طالب، 37488 حضور، 37002 حركة
- teacher portal = «حضرتك جاي إمتى + عدد الطلاب فيها كذا + رسالة» بالحرف
- commit: e8de7ba
- ملاحظة للاصلاح لاحقًا: scripts/ القديمة (capacity-load.ts إلخ) فيها أخطاء TS خارج البناء — مرتبطة بالميزات المحذوفة

---
Task ID: teachers-tab-plus-simplify
Agent: Super Z (main agent)
Task: «حط tab للمدرسين» + تبسيط السيستم ككل (دمج صفحات، تقليل تعقيد، تحسين واجهات) — مالي + حضور فقط.

Work Log:
- اكتشفت أن db/custom.db كان فاضي تاني (0 users) → استرجعت db-backup-20261015/custom.db (43.5MB) وطبقت عليها schema الحالي بـ prisma db push → رجعت البيانات كاملة (5 users، 5000 طالب، 37488 حضور، 37000 حركة، 30 مدرس، 60 slot). رست كلمة سر qae-mgr-99 / qae-rec-99 → Qae#2026 (الحقل passwordHash).
- shell.tsx: إعادة هيكلة التنقل — ViewId: operations اتشال، teachers اتضاف (أيقونة Presentation، ليفل «المدرسين»). TABS الجديدة (7): الرئيسية [home] · اليوم [today, scan, approvals, emergency] · الطلاب [students, messages] · المالية [payments, accounting, books, reports] · المدرسين [teachers] · الحصص [schedule, groups] · الإعدادات [settings]. TabId type اتحدث، ROLE_ALLOWED: الاستقبال اتضاف له teachers، ناف الموبايل بقى 5 تابات + المزيد (grid-cols-6)، بانر الترحيب اتحدث + مفتاح localStorage nk-seen-restructure-v2، VIEW_PREFETCH: teachers/accounting.
- جديد /api/teachers (requireCenterUser): كارت كل مدرس = الحصة الجاية بحساب توقيت القاهرة (النهاردة/بكرة/اسم اليوم/الاسبوع الجاي + startTime/endTime/قاعة) + عدد طلاب المجموعة + حصص الأسبوع + إجمالي الطلاب + subjects/grades/groups + payable (مدير فقط من TeacherSettlement groupBy) + summary. الترتيب: اللي عنده حصة النهاردة الأول.
- جديد teachers.tsx (TeachersView): PageHeader + إحصائيات (مدرس نشط/حصص الأسبوع/إجمالي الطلاب/مستحقات معلقة للمدير) + بحث بالاسم/المادة + كروت (الاسم + الحصة الجاية بخلفية brand-soft + عداد الطلاب + chips + واتساب بضغطة بـ buildWaUrl/openWhatsAppHandoff + اتصال tel) + PayRow صرف مستحقات فوري (مدير فقط، مبلغ متعب مسبقًا، POST /api/accounting pay-teacher). تحديث دوري كل 60 ثانية.
- app.tsx: case "teachers" + حذف OperationsView. command-palette.tsx: navIds اتحدثت (operations → teachers) للمدير والاستقبال. حذف operations.tsx نهائيًا (القاعات أصلًا في الجداول RoomsDialog + تنبيهات التعارض في schedule API؛ الطوارئ بقت في تاب اليوم).
- اختبار e2e بالمتصفح (agent-browser): login qae-mgr-99 → السايدبار = 7 تابات الجديدة ✓ · تاب المدرسين بي render 30 كارت بالحصة الجاية وعداد الطلاب ✓ · المالية: شيبس الدفع/الحسابات/الكتب/التقارير كلها بتشتغل ✓ · الطوارئ جوه اليوم ✓ · موبايل 390px: 5 تابات + المزيد (الحصص/الإعدادات) ✓ · اختبار صرف حقيقي: عملت EARNED 500ج → الزرار ظهر بالمبلغ المتعب → صرف → PAID −50000 + centerTransaction TEACHER_PAYOUT → نضّفت بيانات الاختبار ✓ · صفر أخطاء console، tsc src = 0، eslint نظيف.
- ملاحظة: tsc errors في scripts/ و skills/ قديمة وخارج البناء (معروفة من التاسك اللي فات).

Stage Summary:
- المدرسين ليهم تاب كامل: «حضرتك جاي إمتى + عدد الطلاب فيها كذا + واتساب/اتصال + مستحقاته وصرفها بضغطة» — نفس فلسفة بورتال المدرس بس من ناحية الإدارة.
- المالية اتوحدت في تاب واحد (كانت متفرقة في 3 تابات: الدفع جوه الطلاب، الحسابات جوه القاعات والتشغيل، التقارير لوحدها).
- تاب «القاعات والتشغيل» اتمسح خالص (صفحة أقل)، و«الطلاب والمعلمين» بقت «الطلاب» بصراحة (كان الاسم بيوعد بحاجة مش موجودة).
- التنقل: 7 تابات لكن بتوزيع منطقي — الموبايل بيعرض الخمسة اليومية (رئيسية/يوم/طلاب/مالية/مدرسين) والباقي في «المزيد».
- البيانات التشغيلية سليمة 100% بعد استرجاع الـ DB.

---
Task ID: prod-demo-seed
Agent: Super Z (main agent)
Task: إنشاء أكونت الـ 5000 طالب في الإنتاج (المالك جرب qae-mgr-99 على vercel وفشل — الأكونت كان محليًا بس) + دفع تحديثات الكود المعلقة للإنتاج.

Work Log:
- تشخيص: qae-mgr-99 موجود فقط في db/custom.db المحلية؛ الإنتاج (alnokhba-centers-nine.vercel.app) قاعدة Postgres منفصلة (Supabase ref ttydfyqwzkwivucgiegy) — تأكدت بـ 401 حقيقي من /api/auth
- المالك بعت رابط Supabase + الباسورد → حفظته في scripts/.dbpass (chmod 600 + .gitignore)
- اكتشفت أن origin/main متأخر 5 كوميتات عن HEAD (الـ descope المالي + تاب المدرسين لم يكونا منشورين!) — الإنتاج كان شغال بالنسخة الأكاديمية القديمة
- فحص سكيما be2e963 (المنشورة): User.scope له default، كل الحقول المحذوفة nullable/defaults → الزرع بالعميل الجديد آمن على السكيما القديمة
- فحص تعارض أكواد الطلاب (Student.code @unique عالمي): المدى المخطط 14950-19949 صفر تعارض مع الأكواد الحقيقية
- ترقيع scripts/qae/seed.ts: حذف مراجع exam/quiz/aca المحذوفة من السكيما + حذف scope + إلغاء إنشاء qae-admin في الإنتاج (ثغرة: أدمن منصة بباسورد معروف يوصل للسنترات الحقيقية) + دفع الطلاب بـ createMany (500/دفعة) بـ IDs صريحة qae99sNNNNN
- زرع: seed stress → سنتر qae-c99-stress + 4 مستخدمين (mgr/rec/recl/tch) + 5000 طالب + 30 جروب + 30 مدرس + 60 slot في أقل من دقيقة
- سكريبت جديد scripts/seed_prod_ops.mjs (مشتق من perf.ts بدون benchmarking): 28 يوم تاريخ → 240 سيشن CLOSED + 37,458 حضور PRESENT + 40,269 حركة (37,458 CHARGE + 2,811 TOPUP دفعات والي أمر 200-600ج لتوزيع أرصدة مختلط — أحسن من النسخة المحلية اللي كانت كلها سالب)
- regenerating prisma client: postgres → sqlite بعد الزرع (حماية dev server)
- push be2e963..a3b433c → Vercel auto-deploy

Stage Summary:
- الإنتاج فيه سنتر التجربة كامل: qae-mgr-99 / qae-rec-99 / qae-recl-99 / qae-tch-99 — كلهم Qae#2026 — 5000 طالب + 240 سيشن + 37,458 حضور + 40,269 حركة مالية
- بيانات المالك الحقيقية (مركز النخبة التعليمي 25 طالب + سنتر الأمل 8) لم تُمس — الزرع محصور qae-*
- الكود الجديد (financial-only + teachers tab) انشر للإنتاج أول مرة
- ملاحظة: مفيش platform-admin تجريبي في الإنتاج عن قصد

---
Task ID: prod-demo-seed-fix
Agent: Super Z (main agent)
Task: متابعة prod-demo-seed — إصلاح 500 على تسجيل الدخول في الإنتاج بعد النشر.

Work Log:
- بعد النشر: POST /api/auth على الإنتاج = 500 (باستمرار، ~1.4s لكل محاولة) رغم أن /api/teachers = 401 وdb-status = postgres
- إعادة إنتاج محليًا (dev على 3001 بنفس كود HEAD + نفس قاعدة الإنتاج): أول محاولة فشلت بسبب mismatch عميل Prisma (كنت مولّد عميل sqlite والرابط postgres) — بعد توليد عميل postgres: **الدخول نجح 200** + /api/teachers = 30 مدرس + /api/students = 5000
- استبعاد الكود والقاعدة بالكامل (نفس النسخة تعمل محليًا على نفس القاعدة) → المشكلة = قيمة DATABASE_URL في Vercel (المالك حدّثها قبل يوم — والـ deployment القديم كان شغال بالقيمة القديمة المخبوزة؛ نشر الكود الجديد فعّل القيمة الجديدة الغالطة)
- التوقيت الثابت 1.4s = فشل اتصال/تحقق سريع (الرابط غالبًا لسه فيه [YOUR-PASSWORD] حرفيًا أو الهوست المباشر db.xxx.supabase.co (IPv6-only) مش متاح من دوال Vercel)
- اختبار الرابطين pooler: 6543 (pgbouncer) و5432 (session) — الاتنين OK؛ 6543 هو الموصى به في docs/PRODUCTION-DB.md للسيرفرلس (وبناء Vercel بيشتق 5432 منه للـ DDL تلقائيًا)
- تنظيف: revert لسطر تشخيص الـ stack في api.ts، قتل سيرفر 3001، إعادة توليد عميل sqlite للـ dev (سيرفر 3000 سليم — دخول محلي 200)

Stage Summary:
- كل حاجة جاهزة في الإنتاج ما عدا قيمة واحدة: DATABASE_URL في Vercel محتاجة تتستبدل برابط الـ pooler + Redeploy
- بعد ما المالك يعمل الخطوتين: الدخول هيشتغل فورًا (مثبت محليًا بنفس الكود + نفس القاعدة)

---
Task ID: prod-500-diagnosis-final
Agent: Super Z (main agent)
Task: تأكيد وجود أكونت الـ 5000 طالب في الإنتاج + تشخيص 500 تسجيل الدخول + حفظ باسورد قاعدة الإنتاج.

Work Log:
- حفظ الباسورد في scripts/.dbpass (chmod 600 — gitignored من سابق)
- الحصول المباشر مرفض: db.ttydfyqwzkwivucgiegy.supabase.co = IPv6-only والبيئة من غير IPv6 → probe 19 region للـ pooler بالـ pg driver (npm i --no-save pg) → المشروع في aws-0-eu-west-2.pooler.supabase.com (PostgreSQL 17.6)
- فحص الإنتاج: 3 سنترات (alnokhba-elite 25 طالب / amal-center 8 / qae-c99-stress 5000) — QAE موجودة بكل بياناتها (5000 طالب، 30 جروب، 60 slot، 240 سيشن، 37,458 حضور، 40,269 حركة، 30 مدرس، 4 مستخدمين)
- عمود الباسورد في الإنتاج = passwordHash (مش password) — 31 مستخدم كلهم scrypt-ok
- تحقق تشفيري من الهاشات المخزنة في الإنتاج نفسها: Qae#2026 بتطابق الـ 4 حسابات QAE كلهم (mgr/rec/recl/tch)
- POST /api/auth على الإنتاج = 500 لكل مستخدم (qae-mgr-99 و manager alike) — مش 401
- الكونفيرم من worklog الجلسة اللي فاتت: نفس الكود + نفس قاعدة الإنتاج اشتغل 200 محليًا → الجاني الوحيد المتبقي = قيمة DATABASE_URL في Vercel (الرابط المباشر IPv6-only و/أو placeholder [YOUR-PASSWORD])
- اختبار pooler 5432 و6543 بالباسورد الجديد: الاتنين OK — التوصية في docs/PRODUCTION-DB.md: 6543 + ?pgbouncer=true&connection_limit=1
- أمان: scripts/save_and_probe_prod_db.py كان فيه الباسورد plain في كوميت محلي مش مpush → نضفته (بيقرأ من .dbpass) + git commit --amend → git log -S متأكد إن التاريخ نظيف تمامًا

Stage Summary:
- أكونت الـ 5000 طالب موجود في الإنتاج بكامل بياناته وكلمات السر متطابقة — كل اللي ناقص: المالك يستبدل DATABASE_URL في Vercel برابط الـ pooler ويعمل Redeploy
- الرابط الصح: postgresql://postgres.ttydfyqwzkwivucgiegy:<PWD>@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
- بعد الإصلاح: كل الحسابات هتشتغل (الحقيقية والتجريبية) — مفيش أي تغيير كود مطلوب
