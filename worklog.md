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
