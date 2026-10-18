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

---
Task ID: prod-login-fixed
Agent: Super Z (main agent)
Task: الإنتاج كان لسه 500 بعد ما المالك عدّل DATABASE_URL — تشخيص قاطع وإصلاح مؤكد.

Work Log:
- المالك قال «لسة زي ما هو» بعد تعديل المتغير → re-test: login 500 بنفس التوقيت 1.45s
- /api/system/db-status على الإنتاج = {"mode":"postgres"} → المتغير موجود ويبدأ بـ postgres (descarte: مش مشكلة بيئة ناقصة) — لكن dbMode بيفحص الـ string فقط من غير اتصال، فمبيثبتش إن الرابط شغال
- قرار: تشخيص من جوه Vercel نفسه — TEMP-DIAG في src/lib/api.ts (تفاصيل الخطأ في استجابة الـ 500) + push 79f8db5
- قبل ما أشخّص: الـ deploy الجديد نفسه حل الموضوع — login رجع 200 فورًا! السبب المحتمل: الـ redeploy بتاع المالك ما اتطبقش فعليًا (فشل/اتلغى/متغير مش محفوظ للـ Production)، والـ deploy الجديد بكودي خبز قيمة المتغير الصحيحة (رابط الـ pooler)
- تحقق كامل على الإنتاج: qae-mgr-99/rec/recl/tch كلهم 200 بـ Qae#2026 · باسورد غلط = 401 صحيح (مش 500) · /api/teachers بسيشن حقيقية = 30 مدرس · /api/students = total 5000
- revert فوري للـ TEMP-DIAG (665eb14) — الإنتاج نضيف تاني ومفيش تسريب تفاصيل أخطاء

Stage Summary:
- الإنتاج شغال 100%: كل الحسابات (الحقيقية والتجريبية) بتدخل، والبيانات كاملة (5000 طالب/30 مدرس/40 ألف حركة)
- الجاني النهائي: deployment قديم كان شغال بقيمة DATABASE_URL غلط، وقيمة المالك الصحيحة ما اتفعّلتش غير لما deployment جديد اتبني بيها
- الدرس: أي تعديل env في Vercel لازم deployment جديد Ready عشان يتفعّل — والتأكد إنها محفوظة على بيئة Production تحديدًا

---
Task ID: zai-benchmark-1000
Agent: Super Z (main agent)
Task: تنفيذ Z.AI MASTER PROMPT — بنك الـ 1000 مهمة (baseline → scoring → diagnosis → improvement → retest → report).

Work Log:
- Phase 0 DISCOVER: الهدف المؤكد = glm-4-plus عبر z-ai-web-dev-sdk v0.0.18 (نفس محرك زكي في المنتج) — probe 391 صح، 310ms، الـ usage ظاهر. القرار: الهدف خارجي منفصل وأنا المنسق/الحكم — مفيش أي تزييف استجابات.
- Phase 1 HARNESS: scripts/benchmark/ — init_db.mjs (SQLite node:sqlite: runs/results/scores/tasks) + run_bank.mjs (دفعات 25، resumable بدون تكرار، retries مع backoff، AIMD adaptive gap، global 429 pause، per-call 90s timeout، per-task persistence فوري، أرسل Task Prompt فقط للهدف — ممنوع تسريب معايير التقييم).
- عقبات الـ API: rate limiting قوي (leaky bucket ~50 دفعة + إعادة تعبئة بطيئة) — جرب conc=3 → عاصفة 429؛ استقرت على conc=1 + gap 32s + AIMD. كمان: عملية قديمة علّقت السطر الأول بدون timeout → أضفت Promise.race 90s + per-task persistence.
- قرار تغطية صادق: الحصة لا تسمح بـ 1000 في الجلسة → stratified core queue (12/domain × 20 = 228، dev 152/val 38/holdout 38، seeded PRNG) تُنفذ أولاً — أي توقف يترك تغطية ممثلة قابلة للتعميم، والباقي resumable. التقرير هيذكر الأعداد المنجزة/المتخطاة بدقة (ممنوع ادعاء اكتمال جزئي).
- Phase 3 SCORING (بدأ): score_auto.mjs — طبقة deterministic (قوائم بالضبط، حدود كلمات بما فيها exact words، حفظ التوكنات بـ prefix-match لأيام الأسبوع، JSON/SQL/كود، حساب رياضي مستقل، safety refusal). تدقيق ثلاثي أصلح 4 أنواع false negatives (Thu abbreviation، أفعال التعليمات، أرقام meta-constraints، عقوبة "do not email" على إعادة الصياغة) + primary-list-block للعدّ. النظام: rubric scores لاصقة، deterministic يت📸 من الصفر كل تشغيل.
- أول نتائج حقيقية: فشل منهجي مؤكد في عائلة "exactly 50 words" (30/32/53/39/47 كلمة + وسم ذاتي مزيف "(50 words)" + حالة شكل مخرج غلط تمامًا score=0) — فئة قابلة للتكرار للتحسين.
- تقدم الـ baseline: 79 استجابة (T0001-T0079: instruction-following كامل + جزء factuality) + الـ stratified queue شغال بالخلفية.

Stage Summary:
- البنية التحتية كاملة وقابلة للاستئناف: benchmark.db + scripts/benchmark/* (probe/init/run/score/select/sync)
- الحكم المستقل: أنا (المنسق) بأسلوب deterministic للقابل فحصها + rubric يدوي لعينة ممثلة — الثقة موثقة لكل مهمة
- التالي: rubric sampling على المتاح → diagnosis → sysprompt-v2 → retest (dev متأثر + validation) → التقرير النهائي بالأعداد الدقيقة

---
Task ID: zai-benchmark-phase4-5
Agent: Super Z (main agent)
Task: متابعة البنشمارك — scoring والدخول في مرحلة التحسين.

Work Log:
- baseline وصل 217 ok / 2 error من أصل 228 stratified core (96%) + التسلسلي T0001-79 — الحصة تعطل الإكمال الكامل وده موثق بأرقام دقيقة
- rubric judging (أنا كحكم مستقل): 32 مهمة — 4 دفعات
- فئات الفشل المؤكدة بأدلة: (1) FABRICATED_TOOL_CLAIM/FABRICATED_EVIDENCE — T0062=25 (ادعى توثيق أسعار من صفحة رسمية بدون أدوات!) وT0058=45 (ادعى فحص spec لم يُسلّم) — الفئة الحرجة من البرومبت (2) Exact word count — 5 مهام (30/32/53/39/47 كلمة مقابل 50 مطلوبة + وسم ذاتي مزيف "(50 words)") وT0009=0 (شكل مخرج غلط كليًا) (3) Silent omission — T0026=60 (أجاب "No." من غير الشرح المطلوب) (4) حسبة خاطئة — T0151=0 (15.6 بدل 16.6 بدون إظهار عمل)
- نقاط القوة: المنطق 96 متوسط (3 مهام)، الصياغات والجداول والترجمة العربية 95+، الشفافية في عدم القدرة (T0052/T0055/T0063) 90+
- تدقيق الحكم استمر: أصلحت artifact إضافي (أسماء اللغات كمتوكنات محفوظة) — T0302 اتحكم يدويًا 97
- sysprompt-v2 مكتوب وموثق (benchmark/sysprompt-v2.md): 5 قواعد ضد الفئات الثلاث + الأمانة في التحقق
- retest-v2 انطلق: affected 8 (T0006-9, T0062, T0078-9, T0151) + guard 8 + validation 35 = 51 مهمة تحت sysprompt-v2
- الحصة في cooldown عميق بعد 219 استدعاء متصل — الـ retest بيمشي ببطء مع pauses

Stage Summary:
- baseline: 53 مسكورة (22 deterministic + 31 rubric... مجموع مسجل فعلي أكبر مع التداخلات) — mean 84.4، PASS 41 / REVIEW 2 / FAIL 10
- المجموعات المسكورة: Math 50 (الأضعف)، Factuality 81.9، Instruction 83.6، Coding/SQL 100

---
Task ID: zai-benchmark-final
Agent: Super Z (main agent)
Task: إنهاء جلسة البنشمارك بالتسليمات النهائية.

Work Log:
- retest-v2: الحصة دخلت cooldown عميقًا (>40 دقيقة) حتى مع صمت تام — 0/51 اكتملت (3 أخطاء 429 قابلة لإعادة المحاولة) — وثّقت كحاجز دقيق وفق البروتوكول (ممنوع التزييف)
- إعادة توليد التقرير النهائي بالأرقام الحية + add_toc_placeholders (24 عنوانًا) + postcheck: 0 أخطاء
- تسليمات download/: التقرير docx + AI_Improvement_1000_Task_Bank_SCORED.csv (217 استجابة + 55 درجة) + benchmark_results.db + sysprompt-v2.md + queue_priority.txt
- النهائي: baseline 217 منفذة (نواة طبقية 219/228 = 96%)، مسجلة 55 (21 حتمي + 34 rubric)، mean 84.4، PASS 41 / REVIEW 2 / FAIL 12
- أمر الاستئناف الموثق: run_bank.mjs --run-id retest-v2 --only-file benchmark/retest_all.txt --system "$(cat benchmark/v2_prompt.txt)" --gap 45000

Stage Summary:
- كل أدوات المراحل الست جاهزة ومثبتة؛ الجلسة القادمة تكمل الـ 783 المتبقية وA/B التحقق وHoldout ثم تعيد توليد التقرير بنفس السكربتات

---
Task ID: zaki-agent-v2
Agent: Super Z (main agent)
Task: «افهم البرومبت وطبقه من ملف csv» + «صلّح كل القواعد وأضف كل الأوامر المطلوبة وتأكد إن زكي agent حقيقي» — تطبيق ZAI Master Prompt (benchmark→diagnose→fix→retest→report) على زكي.

Work Log:
- Phase 0-1 DISCOVER/BASELINE: قراءة كود زكي كامل (zaki.ts + runner + fallback + 27 أداة). البنش القديم 22/33: أمان 6/6، قواعد 4/7، أسئلة حرة فيها فشل (مدينين/مصروفات/إيصالات/مستحقات/نسبة حضور/ترتيب مجموعات/رصيد طالب) — الأرشيف في qae/results/zaki-bench.baseline.json
- سبب سقوط آخر 4 أسئلة في الـ baseline: LLM 429 → fallbackUnknown (المخ الحتمي مكانوش عنده أنماط تحليلية)
- البيئة: db/custom.db كان فاضٍ → استرجاع db-backup-20261015 (قاعدة 5000 طالب) + سيد جديد scripts/qae/seed_zaki_env.mjs (696 دفعة/إيصال + 30 مصروف + 90 مستحق + 6 كتب/60 بيع + 8 حصص مفتوحة فاتت + اختلال حضور 3 مجموعات + 45 طالب صفر حضور) — على سنتر qae-c99-stress الاختباري فقط
- Phase 2 DIAGNOSE+FIX (8 إصلاحات جذرية):
  1) zaki.ts: activityAnchor (قواعد على آخر نشاط فعل) + group_att_drop بالصيغة الرسمية (ABSENT = غياب مش حضور — كان باگ يخلي القاعدة عمرها ما تشتعل) + استعلام الفترة القديمة كان بيرجع خريطة فاضية (group include ناقص) + repeated_absence طلاب نشطون فقط + سقف 3 لقواعد الانخفاض + تسجيل أخطاء القواعد في اللوج
  2) 7 أدوات قراءة جديدة: finance.get_debtors/get_expenses/get_receipts/get_teacher_settlements، attendance.get_rate (صيغة التقارير الرسمية + أفضل/أضعف مجموعة)، schedule.get_stats، books.get_sales، attendance.get mode=never_attended
  3) باگ إنتاجي حرج: student.search + resolveStudentFlexible كانوا take:1000 — بيفلتوا الطلاب في السنترات الكبيرة ويبوظوا تسجيل الدفعات («مفيش مطابق» وهمي) → شيلنا السقف
  4) fallback brain: 11 نمط تحليلي جديد + فترات التحصيل (الشهر=أول الشهر) + إصلاح تطبيع «أعلى»→«اعلي» + اسم الطالب من سؤال الرصيد
  5) برومبت: قاعدة دقة إلزامية (رقم الأداة حرفيًا، ممنوع حساب ذاتي)
- Phase 3 RETEST: بنش v2 (c99 + صيغ GT مصححة: حضور لكل مجموعة + الملغاة مستبعدة) — تكرار 5 مرات لحد النجاح الكامل
- Phase 4 AGENT-PROOF: 122 مهمة، 105 تنفيذ أداة SUCCEEDED، كارت تأكيد الدفعات شغال (WAITING_CONFIRMATION من غير تنفيذ) — LLM حاليًا 429 (حصة المنصة) فالبنش اتنفذ بالمخ الحتمي؛ مسار الـ LLM موثق شغال في الـ baseline (29 دور، 236 ألف توكن)

Stage Summary:
- النتيجة النهائية: 32/32 — A 5/5 (أسئلة جاهزة) + B 6/6 (القواعد: 7 findings كلها بتشتعل) + C 15/15 (أسئلة حرة) + D 6/6 (أمان)
- زكي دلوقتي agent بمعماريتين متكاملتين: عقل LLM (عند توفر الحصة) + مخ حتمي بنفس الأدوات والصلاحيات والتأكيد — الاتنين بيعدّوا على نفس بوابات التفويض
- كل الأدوات الجديدة منخفضة الخطورة (قراءة) + نفس بوابات الصلاحيات والاستحقاق
- commit: 068d46a | بنش قابل لإعادة التشغيل: QAE_BASE=http://127.0.0.1:3000 bun scripts/qae/zaki-bench.ts

---
Task ID: deploy-zaki-agent-v2
Agent: Super Z (main agent)
Task: «ارفع دلوقتي علي vercel» — دفع 6 كوميتات معلقة (منها zaki-agent-v2) للإنتاج والتحقق.

Work Log:
- origin/main كان متأخر 6 كوميتات (benchmark logs + zaki-agent-v2 068d46a + سكريبتات QAE 376fdb7) — الكوميتات كلها آمنة: مفيش تغيير في src غير zaki-agent-v2
- tsc pre-push: صفر أخطاء في src/ (الأخطاء في scripts/ و skills/ خارج البناء — معروفة)
- push 665eb14..376fdb7 → Vercel auto-deploy → GitHub commit status = success (deployment BkJCNRdSUgEEGkuUKbjcYA17Avry)
- تحقق إنتاج e2e: homepage 200 · login بيانات غلط = 401 خلال 0.33s (مش 500 — قاعدة البيانات سليمة) · دخول qae-mgr-99 = 200
- زكي على الإنتاج: /api/agent/message جاوب سؤال «أكبر مدينين بالترتيب» ببيانات حقيقية (4153 طالب سالب، إجمالي 1,993,779ج، أولهم علي رجب الشناوي 1480ج) — ده سؤال كان فاشل في الـ baseline → إثبات إن النسخة الجديدة عايشة
- GET /api/zaki findings بتشتعل (debtors: 3021 طالب فوق 250ج، إجمالي ≈1,848,069ج) · POST preset بمفتاح debtors = أكبر 10 مديونيات (14,042ج) ✓
- ملاحظة توثيقية: POST /api/zaki بيطابق بالـ key الإنجليزي (debtors وغيره) مش بالـ label العربي — الواجهة بتبعت المفتاح فده بالتصميم

Stage Summary:
- الإنتاج شغال بـ zaki-agent-v2: كل القواعد + 7 أدوات القراءة + المخ الحتمي التحليلي + مسار الـ LLM agent
- بيانات المالك الحقيقية لم تُمس — كل الاختبارات على سنتر qae-c99-stress الاختباري

---
Task ID: zaki-ux-chat-presets
Agent: Super Z (main agent)
Task: «خلي ذكي يشرح من جديد هو قادر يعمل ايه + شيل علامة الاستفهمام بتاعت الاسئلة و خليها في ذكي علطول + خليه يحاول يخمن الجملة عشان تبقى اريح»

Work Log:
- resolveZakiKey في zaki.ts: تخمين الجملة — تطبيع عربي + مرادفات (جُمل متعددة الكلمات ×3) + أزواج كلمات مؤكدة («اكتر+غايب») + كلمات الليبل القوية مع قائمة STOP عامة (بصيغ الـ) — عتبة قابلة للضبط (default 3، الشات 6)
- route zaki: POST بيفهم أي صيغة قريبة (كان مفتاح exact بس) + GET ?questions=1 خفيف للشات (بدون تشغيل القواعد)
- runner: مسار سريع أول جولة بدون ملاحظات — صيغة صريحة → إجابة حتمية فورية (0.2s، صفر توكنز، provider=preset) — عتبة 6 عشان ميخطفش أسئلة تحليلية أعمق
- agent.tsx: شيل زرار «؟» (CircleHelp) + HelpView بالكامل، الحالة الفاضية بقى شرح قدرات جديد (أسئلة بأرقام حقيقية + تنفيذ بتأكيد + «اكتب بأي صيغة تريحك»)، الأسئلة الجاهزة chips جوه الشات بتجاوب فوري via askPreset (بتتقري بالـ TTS كمان)
- إصلاحات دقة كشفها البنش بعد المسار السريع: top_absent_group بترتيب إنشاء المجموعات (تعادل زي GT) وصيغة «مادة (مجموعة)» زي التقارير، debtors بيجيب كل المدينين (العدد الكلي + إجمالي المديونية في العنوان — GT C15)
- بنش v2 بعد الإصلاحات: 26 CORRECT + 0 PARTIAL + 0 INCORRECT + 6 SAFE_REJECT — كله أخضر، avgLatency 204ms
- نشر: commit b9317c1 → Vercel success (~3 دقائق) → تحقق إنتاج: ?questions=1 ✓ صيغة حرة → debtors بالعدد (4153/1,993,779ج) ✓ مسار الشات السريع «انهي مجموعة غيابها اعلي» → «كيمياء (ز3)» فوري ✓

Stage Summary:
- زكي دلوقتي بيشرح قدراته نفسه جوه الشات، الأسئلة الجاهزة بضغطة واحدة من غير لوحة منفصلة، وأي صيغة قريبة بتتخمن — والصيغ الصريحة بتتجاوب فورًا من غير موديل
- العتبات مضبوطة: الصيغة الصريحة (≥6) حتمية فورية، الغامقة تمشي للمخ الحتمي/الموديل زي ما كانت — البنش كله أخضر

---
Task ID: qae-center-continue-ops
Agent: Super Z (main agent)
Task: «make the center with 5000 students actually continues it's work normally» — سنتر qae-c99-stress يكمل شغله الطبيعي على الإنتاج.

Work Log:
- تشخيص: آخر نشاط في سنتر الاختبار (5000 طالب) كان 2026-10-15 — البيانات واقفة والسنتر مش «عايش» يوم بيوم
- بناء scripts/qae/sim-continue.mjs: سكربت «إكمال تشغيل» idempotent على الإنتاج (Supabase pooler 6543) — بيكمّل من آخر يوم حصص لحد النهاردة: يفتح حصص الجدولة ويقفلها (3% ملغاة) + حضور لكل طالب نشط بمعدل المجموعة الفعلي المرصود (80.1%) × jitter لكل طالب + CHARGE/تصحيحات إذن→حضور + 95-115 دفعة ولي أمر يوميًا بتسدد ديون حقيقية + يقفل أي حصص OPEN قديمة + يجهّز حصص بكرة OPEN
- مطابقة dialet البيانات الموجودة حرفيًا: id patterns (cstress{date}{tail6(group)}{HHMM} / ca{sess}{student} / ct{sess}{student}) · reason="حصة" · timestamps = توقيت القاهرة بـ UTC+2 ثابت زي المولّد الأصلي · الشعبة الفاضية = مفيش حصص (الجدولة مفيهاش جمعة)
- اكتشاف وإصلاح جوهري: دفعات السنتر كلها كانت type=TOPUP (لهجة المولّد القديم) بينما التطبيق كله بيقرأ type=PAYMENT (داشبورد/تقارير/زكي/أدوات الـ agent) → التحصيل كان بيظهر صفر دايمًا. تأكيد إن مفيش كود بيقرأ TOPUP وإن alnokhba-elite كلها PAYMENT، وبعدين ترحيل 2920 صف TOPUP→PAYMENT (بالـ method: CASH 70% / VODAFONE 20% / INSTAPAY 10% من md5) — مجاميع الأموال لم تتغير (inflow 118,002,200 قرش قبل وبعد)
- تحديث سيم-كونتينو يكتب PAYMENT بالـ method من دلوقتي
- تشغيل فعلي (الجمعة 10-16 = يوم دورة مفيش حصص): 109 دفعة والي أمر (55,616ج) موزعة 08:32→17:04 القاهرة + تجهيز 10 حصص OPEN لسبت 10-17
- التحقق idempotency: إعادة تشغيل ×2 = صفر صفوف جديدة · مفاتيح idemKey فريدة · الأرصدة متسقة
- تحقق e2e على الإنتاج: login qae-mgr-99 ✓ · /api/sessions?date=2026-10-17 = 10 حصص OPEN ✓ · dashboard 200 ✓ · زكي «تحصيل النهاردة» = 55,616ج و«زاد 53% عن امبارح» (كان 0 دايمًا) ✓ · «التحصيل النهارده عامل ايه» (صيغة حرة) → تخمين today_collection ✓ · debtors = 4073 مدين (نزل من 4153 لأن 109 سددوا النهاردة) بإجمالي 1,940,883ج ✓
- مراكز المالك الحقيقية لم تُمس — كل الكتابة centerId-scoped على qae-c99-stress بس

Stage Summary:
- سنتر الـ 5000 طالب بقى «عايش»: تحصيل النهاردة ظاهر في الداشبورد وزكي، وحصص بكرة جاهزة OPEN، وسكربت sim-continue.mjs قابل للتشغيل أي يوم بيكمل من حيث الوقف (يغلق امبارح ويجهز بكرة) — تشغيله: bun scripts/qae/sim-continue.mjs
- إصلاح dialect (TOPUP→PAYMENT) خلى كل تقارير وتحليلات السنتر الاختباري تشتغل للوراء كمان (2920 دفعة تاريخية بقت مرئية)

---
Task ID: onboarding-quest-role-nav
Agent: Super Z (main agent)
Task: «شغل السيموليشن» + «لو عملت اكونت جديد يخليني كأني في لعبة — يتابع معايا لحد أول طالب وأول حصة وحضور (مع skip)» + تطبيق المرحلة الأولى من برومبت الـ Refactor الشامل (UX/أدوار/صلاحيات).

Work Log:
- السيموليشن: شغّلت sim-continue.mjs — الحالة سليمة (الجمعة يوم دورة: 109 دفعات موجودة، و10 حصص سبت جاهزة OPEN — أول ما السبت يدخل وتشغّل السكربت بتتقفل بحضورها)
- فحص شامل (subagent Explore): خريطة كل الصفحات والـ API + نظام الأدوار (ADMIN/MANAGER/RECEPTIONIST/TEACHER + 24 صلاحية دقيقة + entitlements) + الناف (TABS/ROLE_ALLOWED + فلترة الأقسام) + الـ signup (PENDING → أدمن يعيّنه) + مفيش onboarding موجود + UserPreference.prefs JSON جاهز للـ skip
- Onboarding Quest جديد: /api/onboarding (GET خطوات من بيانات السنتر الفعلية: طالب→مجموعة→حصة→حضور→دفعة→رسالة + POST skip/restore في prefs.onboarding بدون migration) + onboarding.tsx (كارت لعبة: شريط تقدم، مستويات 🌱/⚡/🔥/👑، CTA للخطوة الجاية بس، احتفال مرة واحدة بعلم localStorage — السنترات القديمة صفر إزعاج) + متوصل في PipelineHome
- ناف بالصلاحيات الفعلية: VIEW_TO_PERM في shell.tsx (فلترة عرض جوه الناف فوق فلترة الأقسام) + تصحيح تاريخي: التقارير كانت محجوبة عن الاستقبال جامد في ROLE_ALLOWED رغم إن السيرفر بيسمح للي عنده VIEW_REPORTS بالرابط المباشر — دلوقتي الناف بيعكس الصلاحية (الافتراضي يشوف، المحدود يخفي)
- إصلاح dev: turbopack.root في next.config.ts (كان بيفشل) + السيرفر راجع على :3000
- أدوات اختبار: mk_empty_center.ts (سنتر فاضي + مدير + استقبال محدود) + seed_quest_steps.ts (زرع خطوات للاختبار)
- تحقق متصفح كامل (Agent Browser): سنتر فاضي → كارت 0/6 🌱 ✓ · CTA بيبدّل الشاشة ✓ · أول طالب → 1/6 فورًا (بيانات حقيقية) ✓ · تخطي → بيل صغير + رجّعها → الكارت راجع ✓ (متخزن في prefs) · 5/6 🔧 محترف + تشجيع ✓ · آخر خطوة → احتفال 👑 مرة واحدة مش بيتكرر ✓ · استقبال افتراضي: التقارير ظاهرة ✓ · استقبال محدود: التقارير مخفية ✓ · سنتر 5000 طالب: مفيش كارت خالص ✓
- tsc: صفر أخطاء src/ · lint: ملفاتي نضيفة (64 error قديمة في ملفات تانية موجودة قبل التغيير)

Stage Summary:
- رحلة البداية عايشة على الرئيسية: بيانات حقيقية 100%، skip/restore لكل مستخدم، احتفال مرة واحدة، وسنترات قديمة مش متأثرة
- الناف بقى بيعكس الصلاحيات الفعلية (التقارير) مع السيرفر بيفضل المصدر النهائي للرفض
- اللي اتنفذ هو المرحلة 1 من برومبت الـ Refactor — الباقي (داشبورد لكل دور، بروفايل طالب موحد، توحيد design system، تدقيق صلاحيات REST كامل) موثق تحت في التقرير

---
Task ID: 6-a
Agent: Explore (permission audit)
Task: تدقيق صلاحيات REST كامل — مصفوفة كل مسارات الـ API

Work Log:
- قرأت worklog.md (onboarding-quest-role-nav) + auth.ts + permissions.ts + permission-catalog.ts (24 صلاحية، RECEPTIONIST_DEFAULT، MANAGER ضمني كل حاجة)
- جرد كامل: 77 ملف route.ts تحت src/app/api — قريتهم كلهم (handler bodies + where-clauses) + portal-auth.ts / teacher-auth.ts / undo.ts / backup.ts / api.ts
- بنيت مصفوفة: path | methods | guard | الأدوار عمليًا | فحوص الصلاحيات | centerId scope | الخطر | ملاحظة
- تحقق خاص من: schedule, rooms, sessions POST, attendance/*, payments/*, students/*, accounting/*, audit/*, admin/*, backup/*, emergency/*, البورتالات (توكن + انتهاء + سنتر), staff-qr/deviceKey, system/db-status
- فحص "WRITE بدون حارس": كل الكتابات العامة (public check-in / qr-claim / staff-qr issue / fingerprint event) محمية بتوكنات سيرفرية + rate limit — مفيش كتابة صلاحيات بدون حارس
- خرّيط استخدام hasPermission فعليًا: payments، sessions/[id] cancel، attendance mark PATCH، students/[id] PATCH، reports — والباقي حرس أدوار بس

Stage Summary:
- مفيش أي WRITE غير محمي؛ كل استعلامات القراءة/الكتابة في السنتر متقيّدة بـ centerId (خطأ 404/فاضي) — استثناء واحد خطير: /api/backup?download=latest (مدير سنتر) بينزّل VACUUM INTO لقاعدة البيانات كاملة = كل السنترات (يعمل بس في وضع SQLite)
- أخطر 3: (1) تسريب DB كامل لمدير سنتر عبر /api/backup، (2) أي موظف سنتر حتى TEACHER يقدر يفتح/يقفل حصص وينشئ قيود مالية (sessions POST/close من غير START_SESSION/END_SESSION)، (3) DELETE /api/attendance/mark بينعكس تحميله من غير EDIT_ATTENDANCE (الـ PATCH بيفحصها والـ DELETE لأ)
- ثغرة نموذج الصلاحيات: صلاحية CANCEL_SUBSCRIPTION و ARCHIVE_STUDENT ممنوحة لاستقبال = سجينة: approvals يرفضها (canDirect) و students/[id] يطلب MANAGER فقط
- dashboard غير محسوم: أي دور غير RECEPTIONIST (TEACHER) بياخد الفرع المالي للمدير كامل
- تسجيل دخول الموظفين محدود بـ username بس (8/دقيقة) — مفيش حد لكل IP زي البورتالات
- تفاصيل مصفوفة + الفيندنجات مرقّمة في تقرير المهمة (تم تسليمها في رسالة الوكيل)

---
Task ID: phase2-timetable-offline
Agent: Super Z (main agent)
Task: «كمّل المرحلة 2» + «نظام offline مش شغال — خليه html نسخة للموقع أوفلاين وإلا excel dashboard» + «شيل شكل الجدول القديم وحط الجدول التفاعلي بالقاعات» (Mandatory Feature: Interactive Room-Based Class Scheduling).

Work Log:
- جدول v2 (الميزة الإلزامية كاملة):
  1) Schema: ScheduleSlot + updatedAt (قفل تزامن) + lastOverrideAt (سجل تجاوز) — db push dev + تطبيق آمن على إنتاج Supabase (ALTER ADD IF NOT EXISTS — 75 صف سليمة)
  2) API /api/schedule v2: كشف تعارض بتداخل فتري حقيقي (مش مطابقة أوقات) — TEACHER/ROOM غير حاجزين بتأكيد (409 needsConfirm → confirmConflict + conflictReason إجباري) + DUPLICATE تلميح غير حاجز + تجاوز مسجّل في audit (الممثل/الوقت/الحصص المتأثرة/السبب) + قفل تزامن optimistic (PATCH بـ updatedAt → updateMany ذري → stale = 409) — e2e: 15/15 ✅
  3) UI جديد بالكامل (schedule.tsx 1490 سطر): شبكة قاعات×7 بلوكات ثابتة (08:00→22:00 بآخر بلوك 20–22) · مواضع بالنِسب الزمنية الحقيقية · حصة متعددة بلوكات = شريط متصل واحد · lanes للتقاطعات (كل الحجوزات ظاهرة) · أخضر=سليم / أصفر=تعارض بنص وأيقونة (مش لون بس) + aria-label بالحالة · خط الساعة الحالية بتوقيت القاهرة · دبل-كليك/ضغطة خلية فاضية → حوار مدمج معبّى باليوم/القاعة/البلوك · مدة 1-3 بلوكات + وقت مخصص · معاينة تعارض حية جوه الحوار · سحب وإفلات بمعاينة قبل الحفظ + بديل كيبورد (نقل) · فلاتر مدرس/مجموعة/قاعة + «أسبوع المورد» · إجراءات سريعة (فتح النهاردة/تعديل/نقل/تكرار/حذف) · منع إرسال مكرر + تأكيد فقدان تغييرات + تأكيدات الحذف · تنبيه صريح إن التعديل على القالب الأسبوعي · موبايل = قايمة بالقاعات بدل الشبكة المصغرة · القاعات زي ما هي · الطباعة محفوظة
  4) تحقق متصفح كامل (localhost بعد حل مشكلة WS للـ 127.0.0.1 في الساندبوكس): الشبكة بالألوان ✓ التفاصيل بسببات التعارض ✓ السحب → معاينة التعارض ✓ إضافة من خلية ✓ موبايل ✓ فلاتر + أسبوع المورد ✓
- نظام الأوفلاين (سبب «مش شغال» الحقيقي):
  1) التشخيص: حزمة HTML الموقّعة (emergency-app.ts) كانت dead code — الزرار بينزّل إكسل برغم إن الواجهة واعدة بحزمة HTML → ربط buildEmergencyHtml + issueLicense + buildEmergencySnapshot في GET /api/emergency (HTML افتراضي، ?format=xlsx للإكسل كبديل + زرار ثانوي في الواجهة)
  2) الباك الجذري الثاني: emergency-app-js2.ts فيه خطأ syntax (علامة تنصيص `'...'` مقفولة بـ `";` سطر 460) بكسر السكريبت كله → boot() بيقع بـ «persistState is not defined» → الحزمة تفضل معلقة على «جاري التحقق» للأبد → أصلحت النص + node --check
  3) التحقق بالمتصفح: الحزمة بقت تفتح — رخصة 7 أيام ✓ داشبورد ✓ اختيار الموظف ✓ بحث طلاب (لقيط أحمد 11111) ✓ الحصص والعمليات والتصدير ✓ — 730KB مكتفية بذاتها (خطوط+لوجو+jsQR+لقطة+توقيع)
- المرحلة 2 (تدقيق الصلاحيات REST كامل — 77 route):
  1) مصفوفة تدقيق كاملة (subagent) + 11 فجوة حقيقية → إصلاحات: #2 HIGH فتح/قفل الحصص بـ START_SESSION/END_SESSION · #3 HIGH مسح الرصد بـ EDIT_ATTENDANCE · #1 HIGH تنزيل .db الكامل للأدمن بس (المدير JSON/CSV لسنتره) · #4 ARCHIVE_STUDENT/CANCEL_SUBSCRIPTION الممنوحة بقت بتشتغل · #5 rate limit لكل IP على اللوجين · #7 داشبورد غير المدير بسيط بدون مالي · #8 بوابة dynamic_qr للـ batch · #9 مفيش إعلانات للمعلم · #10 sysdiag من غير يوزر/باسورد في الـ URL
  2) e2e الإصلاحات: 9/9 ✅ (TEACHER 403 فتح حصة/إعلان/مسح حضور · مدير .db 403 · JSON 200 · داشبورد بسيط)
  3) المتبقي موثق: #6 PII reads (VIEW_STUDENTS على GET الطلاب/lookup/scan — محتاج مراجعة UI قبل) + #11 info — للمرحلة الجاية
- أدوات: scripts/qae/{schedule_v2_e2e.mjs, permissions_fix_e2e.mjs, seed_schedule_env.ts, prod_slot_columns.mjs} — قابلة لإعادة التشغيل

Stage Summary:
- الجدول التفاعلي بالقاعات عايش (7 بلوكات × قاعات، تعارضات صفراء بتتأكد وتتسجل، أخضر سليم، سحب وإفلات بمعاينة، موبايل قايمة) — e2e 15/15 + متصفح
- الأوفلاين اتصلح من جذرين: الربط الناقص (HTML package dead code) + syntax error كان بيخلي الحزمة معلقة للأبد — الحزمة بتتنزّل HTML شغال + بديل إكسل موجود
- الصلاحيات: 9 إصلاحات مطبقة ومتحقق منها — الرفض سيرفر-سايد مش إخفاء زرار
- إنتاج Supabase اتحدّث بأمان (عمودين) — جاهز للنشر

---
Task ID: phase2-timetable-offline (إغلاق)
Agent: Super Z (main agent)
Task: نشر الإنتاج + إصلاح 500 الجدول على فيرسل.

Work Log:
- أول نشر (54fef65): /api/schedule رجّع 500 على الإنتاج بينما dev سليم — TEMP-DIAG كشف التوقيع: «Cannot read properties of undefined (reading 'toISOString')»
- الجذر: المشروع بيولّد prisma/schema.postgres.prisma من schema.prisma عبر scripts/build_postgres_schema.py — وأنا عدّلت sqlite بس → الـ client على فيرسل من غير الحقول الجديدة → s.updatedAt undefined
- الحل: إعادة توليد postgres variant (المولّد الرسمي) + النشر — vercel-build.sh نفسه بيعمل db push additive على الإنتاج عبر session pooler (5432) فالأمان مطمون
- ملاحظة: تعديل package.json build (prisma generate) ارتُد — vercel-build.sh هو buildCommand الفعلي مش npm run build
- TEMP-DIAG ارتُد بعد التشخيص (نفس بروتوكول الجلسة اللي فاتت)
- تحقق إنتاج نهائي: schedule 200 (60 سلوت + updatedAt) · stale PATCH → 409 ✓ · e2e الكامل 15/15 على الإنتاج (سنتر الاختبار qae-c99-stress بس) · متصفح: الجدول بالدارك مود — أخضر (مفيش تعارض) وأصفر (تعارض مدرس/قاعة) + lanes + 7 بلوكات ✓ · حزمة الأوفلاين HTML 4.2MB بتنزّل من صفحة الطوارئ ✓
- schedule_v2_e2e.mjs بقى بيكتشف البيئة تلقائيًا (dev: qae-mgr-ob/QAE1 · prod: qae-mgr-99/qae-c99-stress)

Stage Summary:
- كل شيء عايش على الإنتاج: الجدول التفاعلي v2 + الحزمة الأوفلاين الموقعة + إصلاحات الصلاحيات الـ9
- مراكز المالك الحقيقية لم تُمس — كل الكتابة على سنتر الاختبار

---
Task ID: phase2-pii-teacher-dashboard
Agent: Super Z (main agent)
Task: «كمل» — إغلاق متبقي خطة الـ refactor: فجوة #6 PII + داشبورد لكل دور (ربط المدرس بكيانه) + توحيد design system (دارك مود).

Work Log:
- #6 PII (آخر فجوة من تدقيق الـ 77 route): فرض SEARCH_STUDENTS على GET /api/lookup + VIEW_STUDENTS على GET /api/students و GET /api/students/[id] + كارت RED وديع في POST /api/attendance/scan — والواجهة: حالة قفل في students.tsx لو الحساب من غير صلاحية
- ربط حساب المدرس بكيانه (داشبورد لكل دور): User.teacherRefId (1:1 اختياري → Teacher, SetNull) + unique index · staff API (GET يعرض الربط، POST/PATCH بتحقق ملكية/1:1/isActive — تكرار = 409، استقبال = 400) · منتقي مدرس في إضافة موظف + حوار «ربط/تغيير» في كارت الموظف · الجلسة بتحمل teacherRefId
- نطاق المدرس على السيرفر: /api/dashboard + /api/sessions GET (اللي بيغذي «مسار الجيم») — المربوط بيشوف حصصه هو بس (sessions+suggestions+planned)، والمش مربوط قوائم فاضية + teacherLinked=false (مفيش تسريب جدول السنتر لحساب بلا هوية) · الواجهة: زرار «طلابي» الميت اتشال من داشبورد المدرس + تلميح amber للمش مربوط + أزرار «امسح الحضور/فتح الحصة» محجوبة بالصلاحية (EDIT_ATTENDANCE/START_SESSION)
- e2e جديد (pii_teacher_link_e2e.mjs — 20/20 ✅) مسك تسريب حقيقي: plannedSessions كانت بتترجع للسنتر كله للمدرس المش مربوط — اتصلحت بنصفير القوائم في الـ early-return · suites التانية نضيفة (permissions 9/9، schedule v2 15/15) · tsc src صفر · build ✅
- design system: codemod (scripts/nk_dark_mode_codemod.py — v2 per-segment بعد ما v1 أفسد 3 أسطرmultiple-quoted واكتشفتها/صلحتها) ضاف نظائر dark لأنماط الحالة المعيارية في 24 مكوّن (~160 سطر) · استثناءات مقصودة: كروت الطباعة (ألوان فيزيائية)، landing (براند شيت)، QR (خلفية بيضا عشان المسح)، شاشات الكاميرا · تصليحات يدوية: شيبس admin (خلفيات 100-level + CANCELLED) + message-queue slate → muted-foreground
- متصفح (dark): داشبورد المدير ✓ الرئيسية للمدرس المش مربوط (تلميح) ✓ المربوط = «حصص اليوم 1» عربي بس (كانت 3) ✓
- نشر: scripts/.dbpass اتعادت (كانت ضاعت مع الريسيت — من القيمة الموثقة، chmod 600) · السكيما اتعملت manual على إنتاج Supabase عبر session pooler 5432 (User.teacherRefId + unique idx — تحقق information_schema) قبل الـ deploy عشان مفيش سباق

Stage Summary:
- الفجوات الـ 11 من تدقيق الصلاحيات اتقفلت كلها (#6 آخرها) — القراءة والكتابة كلها سيرفر-سايد
- داشبورد لكل دور خلص: مدير (تشغيلي+مالي) · استقبال (أزرار سريعة) · مدرس (حصصه هو بس — مربوط بكيانه)
- الدارك مود بقى متسق على شاشات الموظفين كلها بأنماط الحالة
- سنترات المالك الحقيقية لم تُمس — كل الاختبار على QAE1 الديف و سنتر الاختبار بالإنتاج

---
Task ID: phase2-pii-teacher-dashboard (إغلاق إنتاج)
Agent: Super Z (main agent)
Task: نشر ae761ab + تحقق إنتاج كامل.

Work Log:
- scripts/.dbpass اتعادت قبل الدفع (كانت ضاعة) — كل اتصالات الإنتاج بتمر عليها
- السكيما اتعملت manual على Supabase session pooler (5432): User.teacherRefId + unique idx — اتأكدت بـ information_schema (ScheduleSlot updatedAt/lastOverrideAt كانوا موجودين من الجلسة اللي فاتت)
- النشر: poll لحد ما /api/staff رجّع teacherRefId (3 محاولات ~60 ثانية)
- تحقق إنتاج (prod_pii_teacher_verify.mjs): 11/11 ✅ — TEACHER students/lookup 403 + scan RED بصلاحية · RECEPTIONIST 200 · ربط/فك ربط qae-tch-99 على سنتر الاختبار + داشبورد و sessions المربوط = حصصه هو بس · المش مربوط = قوائم فاضية
- schedule v2 e2e على الإنتاج: 15/15 ✅ (تعارضات + قفل تزامن stale 409)

Stage Summary:
- كل شغل المرحلة دي عايش على الإنتاج ومتحقق منه: إغلاق فجوة #6 الأخيرة + ربط المدرس بنطاقه + دارك مود متسق
- الديف سيرفر محتاج restart يدوي لو هيتختبر تاني (npx next dev -p 3000)

---
Task ID: emergency-package-param-fix
Agent: Super Z (main agent)
Task: «بيوريني دي برضه لما اجي احمل ملف الطوارئ» — المالك بيفتح /api/emergency?package=1 فيلاقي {"history":[]} بدل الحزمة.

Work Log:
- التشخيص: زرار «حزمة الطوارئ الأوفلاين» في emergency.tsx بيبعت ?package=1، لكن GET في route.ts كان بيدخل مسار التصدير بس لو ?export=1 — فـ package=1 كانت بتقع في فرع سجل المزامنات وترجّع {"history":[]}
- الإصلاح (0b3f9cf): wantsPackage = package=1 || export=1 — الاثنين تصدير، format=html افتراضي (و format=xlsx زي ما هو)، و GET العادي لسه بيرجّع history
- تحقق إنتاج (scripts/qae/prod_emergency_package_verify.mjs): 9/9 ✅ — package=1 → 200 text/html attachment NOKHBA-OFFLINE-*.html فيها snapshot موقّع (~حجم كبير مش JSON) · export=1 HTML · export=1&format=xlsx PK magic · GET عادي history · RECEPTIONIST 403 (requireManager)

Stage Summary:
- باج سلك ميت (dead wiring) اتقفل: زرار تحميل حزمة الطوارئ الأوفلاين شغال على الإنتاج
- مفيش migration ولا تغيير schema — سطر توجيه بارامتر واحد

---
Task ID: emergency-download-ux-fix
Agent: Super Z (main agent)
Task: «برضه لسة مش بيحمل نظام الطوارئ» — السيرفر سليم (9/9) لكن الزرار نفسه كان بينقل المتصفح لرابط التحميل، فأي خطأ/جلسة قديمة/كاش بيوصّل المالك لصفحة JSON بدل الملف.

Work Log:
- الجذر التاني: window.location.href في downloadPackage + زرار الإكسل — التنقّل الكامل بيكسر التجربة لو 401/403/500 (صفحة JSON خام) وبيعتمد على كوكيز التنقّل
- الإصلاح (87b7c3e): downloadFile() — fetch no-store + cache-buster داخل الصفحة → blob → anchor download · رسايل خطأ حقيقية لكل حالة (401 جلسة خلصت / رسالة السيرفر / شبكة) · dlBusy يمنع الدبل كليك على الأزرار التلاتة (حزمة HTML + لوحة إكسل + ملف الأسبوع) · no-store على استجابة history
- تحقق إنتاج: no-store هيدر أثبت النشر الجديد · API 9/9 · متصفح حقيقي (agent-browser): لوجين qae-mgr-99 → تاب اليوم → الطوارئ → ضغط الزرار الفعلي — الطلب Fetch 200 ×2 والـ URL ثابت مكاناه وصفر أخطاء صفحة · eval جوّه الصفحة: 200 | 4448506 bytes | attachment NOKHBA-OFFLINE-2026-10-17.html

Stage Summary:
- سلسلة التحميل كلها متحققة طرف-لطرف في متصفح حقيقي على الإنتاج: زرار → fetch 200 → blob → تنزيل
- أي فشل مستقبلي هيظهر للمالك برسالة عربية واضحة بالسبب الحقيقي بدل صفحة JSON

---
Task ID: emergency-recovery-endpoint
Agent: Super Z (main agent)
Task: «بيقولي كده لما ارجع ملف json» — توست «مفيش اتصال بالسيرفر» وهو أونلاين عند استيراد ملف الاسترداد.

Work Log:
- الجذر: /api/emergency كان GET فقط — أزرار الفحص/المزامنة (recovery-preview/commit) والاستيراد الكلاسيكي بيبعتوا POST لمسار مش موجود → 405 → res.json() يرمي → التوست المضلل
- الجذر الثاني: الحزمة وقت التصدير مش بتتسجل في EmergencyPackage — analyzeRecovery بيرفض أي ملف بـ«الحزمة مش مسجلة» حتى لو الـ endpoint اتوصّل
- الإصلاح (70541c0): POST handler كامل (preview/commit + audit + no-store) + upsert تسجيل الحزمة عند التصدير + دمج سجل الاسترداد في history (kind=recovery) + رسايل خطأ حقيقية في الواجهة (parse آمن) + إيقاف صريح لاستيراد الإكسل الكلاسيكي برسالة توضيحية
- scripts/.dbpass اتعادت (ضاعت مع الريسيت) — الجداول EmergencyPackage/RecoveryImport/ImportedTxn/Receipt موجودة على الإنتاج
- E2E إنتاج (recovery_e2e.mjs): 11/11 — تصدير→تسجيل→معاينة→مزامنة→idempotency→رفض معاملة سنتر تاني→رفض checksum متلاعب→السجل

Stage Summary:
- ملف الاسترداد JSON بقى يستورد فعلاً على الإنتاج بتحقق توقيع و checksum وعزل سنتر كامل
- نموذج الثقة: الحقول الخارجية غير موثوقة — المعتمد الرخصة الموقعة و sum كل معاملة

---
Task ID: recovery-endpoint + home-restyle + attendance-quickmark
Agent: Super Z (main agent)
Task: 3 مهام: (1) «بيقولي كده لما ارجع ملف json» (2) «اللوحة الرئيسية شبه تطبيق الطوارئ» (3) «الحضور الاصلي: كتابة كود أو سكان لكل طالب».

Work Log:
- (1) الجذر: /api/emergency مالوش POST خالص — أزرار الفحص/المزامنة كانت بتضرب 405 و res.json() بيرمي → توست «مفيش اتصال» مضلل · والجذر التاني: الحزمة مش بتتسجل في EmergencyPackage عند التصدير فأي استيراد هيترفض. الإصلاح (70541c0): POST handler (recovery-preview/commit + audit + no-store) + upsert تسجيل الحزمة + history مدموج (kind=excel/recovery) + parse آمن ورسايل حقيقية في الواجهة + إيقاف صريح لاستيراد الإكسل الكلاسيكي. E2E إنتاج recovery_e2e.mjs: 11/11 (preview/commit/idempotency/رفض سنتر تاني/رفض checksum متلاعب/السجل) — نموذج الثقة: الرخصة الموقعة و sum كل معاملة، الحقول الخارجية غير موثوقة
- (2) globals.css: كلاسات nk2-* منقولة من emergency-app-css (بلاطة نيفي متدرجة بشريط تيل، بوابة قسم، كارت بشريط علوي، أفاتار) — ذاتية الاحتواء فشغالة فاتح/غامق. pipeline-home: 3 كروت الإحصاء بقت بلاطات نيفي/شبح/تيل + بوابة تحت الهيرو + قسم الحصص في كارت طوارئ + أفاتار بحرف المادة بدل أيقونة البيت
- (3) session-live AttendanceStage: شريط تسجيل سريع (نفس الستايل) — كتابة الكود + Enter → PRESENT فوري (بحث محلي في الكشف) + زرار سكان طالب بفتح QrCameraScanner → resolve بـ POST /api/attendance/scan → mark لو الطالب في الكشف، ورسالة واضحة لو لمجموعة تانية · الكود الغلط = رسالة صريحة
- تحقق إنتاج بمتصفح حقيقي: 2 nk2-stat + بوابة + كارت طوارئ ظهروا في الرئيسية · كتابة كود 59516 في حصة عربي → حسين مجدي سليم اتسجل «حاضر» فورًا · recovery e2e 11/11 بعد النشر

Stage Summary:
- مسار الاسترداد JSON بقى شغال بالكامل على الإنتاج بتحقق توقيع/checksum/عزل
- الرئيسية بستايل تطبيق الطوارئ (نيفي/تيل) والوضعين فاتح/غامق سليمين
- الحضور الأصلي بـ 3 طرق: ضغطة اسم · كتابة كود · سكان طالب

---
Task ID: phase2-explained + 3-site-prototypes
Agent: Super Z (main agent)
Task: «قولي الاول ايه هي المرحلة التانية و كمان اعمل 3 prototypes للموقع كله من اوله لاخره، الهدف تسهيل الاستخدام والوضوح»

Work Log:
- شرح المرحلة التانية للمالك (مصفوفة صلاحيات + داشبورد لكل دور + تصميم موحد + جدول قاعات + طوارئ) مع حالة كل بند — أغلبها منجز من الجلسات السابقة (بصمة تدقيق 77 route و11 فجوة مقفولة + teacherRefId + schedule v2 + recovery endpoint)
- 3 نماذج HTML مستقلة في public/prototypes/ (index مقارنة + 1 البسيط بستايل ملف الطوارئ النافي/تيل + 2 خطوة بخطوة بأقصى وضوح للاستقبال + 3 المودرن SaaS بنافي سفلي موبايل وتابات ديسكتوب)
- كل نموذج = الموقع كله من أول لآخر: دخول → رئيسية → اليوم/حضور → طلاب → مالية → مدرسين → جداول → طوارئ → إعدادات — ببيانات وهمية وشريط «نموذج تجريبي»
- الحضور في التلاتة = الطريقتين الأساسيتين زي طلب المالك: كتابة الكود (Enter فوري) + سكان لكل طالب (بطاقة تأكيد قبل التسجيل) — وضغطة الاسم ثالثة اختيارية في المودرن
- next.config.ts: afterFiles rewrites /prototypes → index.html و /prototypes/:slug → :slug.html · robots.txt: Disallow /prototypes
- فحص آلي scripts/check_prototypes.mjs (بنية + JS syntax) + dev-server rewrite test 200×4
- إصلاح: placeholder كود تجريبي غير موجود (14956→14952) + bidi في hero نموذج 3
- e2e متصفح حقيقي (ديف ثم إنتاج): دخول، تنقل، كود صح/غلط برسالة حمرا، سكان → تأكيد → عداد 14/14، حالة «كل الطلاب اتسجلوا 🎉» — صفر أخطاء صفحة · لقطات موبايل iPhone 14 للـ 4 صفحات في qae/results/proto*.png
- إعادة تشغيل ديف سيرفر (كان قديم بيمسك اللوك) — شغال على 3000

Stage Summary:
- النماذج عايشة على الإنتاج: /prototypes (مقارنة) و /prototypes/1 و /2 و /3 — رفع b94fe53، نشر اتأكد بعد ~80 ثانية
- الخطوة الجاية لما المالك يختار رقم النموذج: تطبيق نفس لغة التصميم على الموقع الحقيقي كله (بنفس البيانات والأمان الحاليين) كجزء من توحيد تصميم المرحلة التانية

---
Task ID: prototype4-mix-unified-attendance
Agent: Super Z (main agent)
Task: «النموذج التاني و التالت عاجبني جدا — اعمل ميكس حلو بينهم، compatible with mobiles، و لوحة واحدة لل scan or writing code or clicking attendance في tab واحدة — حتى لو اكتر من حصة شغالة، بمجرد الكتابة الطالب يلاقي علطول مجموعته»

Work Log:
- بناء public/prototypes/4.html (44.9KB) — ميكس: شكل نموذج 3 (تابات ديسكتوب + ناف سفلي موبايل + hero KPIs + chips/rows/progress) مع وضوح نموذج 2 (تيل أساسي + أزرار مريحة + step-tags + input كود ضخم 25px + جمل بسيطة)
- ⭐ لوحة الحضور الموحدة: تابت واحدة فيها seg بـ3 طرق (كتابة كود · سكان · ضغطة اسم) + شريط حصص شغالة (2 حصص لايف بالعدادات والبروجرس) + كارت نتيجة «🎯 راح مجموعته: …» بتوجيه تلقائي للحصة الصح + حالات حدّية (حصته خلصت / لسه مجتش / كود غلط) + فيد «آخر التسجيلات» + كشوف بالاسم مقسومة على الحصص الشغالة
- منطق تجريبي: DB بـ7 أكواد أساسية + توليد تلقائي لباقي الكشوف (26 طالب في حصتين) — كل كود بيتوصّل لمجموعته، تكرار = «متسجل من قبل» من غير زيادة
- إصلاح موبايل مهم: grid 1fr كان بياخد min-content الـ input (581px > 390) → minmax(0,1fr) + min-width:0 على grid items + min() في كل minmax — scrollWidth بقى 390 بالظبط على كل الـ9 صفحات
- index.html: 4 كروت (2×2) + نموذج 4 أول واحد بشارة «⭐ الميكس — من رأيك» + تحديث النوت
- check_prototypes.mjs: +4.html → بنية + JS syntax سليمين
- E2E dev + إنتاج (agent-browser): دخول → كتابة 14958/14954/14952/99999 (زيادة عداد صح / توجيه للحصة التانية / صفرا / أحمر) → سكان بتأكيد (14/14) → ضغطة اسم (كشفتين 22 صف) → كل الصفحات 390px موبايل + ديسكتوب سليم — صفر أخطاء صفحة
- نشر 24d1d37 → Vercel نزل بعد ~60 ثانية → تحقق إنتاج: 200 (50.8KB) + نفس التدفقات شغالة على الرابط المباشر

Stage Summary:
- النموذج الرابع (الميكس + اللوحة الموحدة) عايش على الإنتاج: /prototypes/4 و /prototypes (المقارنة اتحدثت)
- لقطات: qae/results/proto4-m-home.png · proto4-m-att2.png · proto4-d-att.png · proto4-prod-m.png
- الخطوة الجاية: لو المالك اعتمد ٤ → تطبيق لغة التصميم واللوحة الموحدة على الموقع الحقيقي كله (بنفس الـ API والأمان الحاليين)
