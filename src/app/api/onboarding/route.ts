import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit, ApiError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* ============================================================
   رحلة البداية (Onboarding Quest) — للسنتر الجديد
   ------------------------------------------------------------
   • GET  — خطوات حقيقية محسوبة من بيانات السنتر الفعلي (مفيش أرقام مفبركة):
       طالب → مجموعة وتسجيل → حصة → حضور → دفعة → رسالة متابعة
   • POST — skip / restore — يتخزن في UserPreference.prefs.onboarding لكل مستخدم
     (من غير migration — نفس نمط /api/preferences)
   • التقدّم بيتحدث لوحده أول ما المستخدم يعمل الخطوة فعليًا في أي شاشة.
============================================================ */

type StepDef = {
  id: string;
  title: string;
  desc: string;
  view: "students" | "groups" | "schedule" | "scan" | "payments" | "messages";
  icon: string;
};

const STEPS: StepDef[] = [
  { id: "student", title: "سجّل أول طالب", desc: "اسم وكود وموبايل ولي الأمر — أقل من دقيقة", view: "students", icon: "UserPlus" },
  { id: "group", title: "اعمل أول مجموعة", desc: "مادة ومدرس ومواعيد — وسجّل الطالب فيها", view: "groups", icon: "Users" },
  { id: "session", title: "افتح أول حصة", desc: "من الجدول الأسبوعي أو اقتراحات النهاردة", view: "schedule", icon: "CalendarDays" },
  { id: "attendance", title: "سجّل أول حضور", desc: "امسح QR أو علّم من كشف الحصة", view: "scan", icon: "ScanLine" },
  { id: "payment", title: "احصّل أول دفعة", desc: "سجّل الاستلام والإيصال يوصل لولي الأمر", view: "payments", icon: "Wallet" },
  { id: "notify", title: "ابعت أول رسالة متابعة", desc: "إشعار غياب أو تنبيه رصيد لولي الأمر", view: "messages", icon: "MessageCircle" },
];

function levelOf(progress: number, total: number): { label: string; emoji: string } {
  const p = total ? progress / total : 0;
  if (p >= 1) return { label: "أسطورة النخبة", emoji: "👑" };
  if (p >= 2 / 3) return { label: "محترف", emoji: "🔥" };
  if (p >= 1 / 3) return { label: "صاعد", emoji: "⚡" };
  return { label: "مبتدئ", emoji: "🌱" };
}

/** prefs JSON الحالي — بنقرأه وندمج عليه بدل ما نبوظ مفاتيح تانية (staffBell وغيرها) */
async function readPrefs(userId: string): Promise<Record<string, unknown>> {
  const pref = await db.userPreference.findUnique({ where: { userId } });
  if (!pref?.prefs) return {};
  try {
    const parsed = JSON.parse(pref.prefs);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export const GET = handler(async () => {
  const user = await requireCenterUser();

  // المدرس مش شغول برحلة تأسيس السنتر — مفيش onboarding ليه
  if (user.role === "TEACHER") {
    return ok({ enabled: false, skipped: false, progress: 0, total: 0, allDone: false, steps: [] });
  }

  const centerId = user.centerId;
  const [students, enrollments, sessions, attendance, payments, notifications, prefs] = await Promise.all([
    db.student.count({ where: { centerId } }),
    db.studentGroup.count({ where: { student: { centerId } } }),
    db.sessionInstance.count({ where: { centerId } }),
    db.attendance.count({ where: { centerId } }),
    db.studentTransaction.count({ where: { centerId, type: "PAYMENT" } }),
    db.notificationAttempt.count({ where: { centerId } }),
    readPrefs(user.id),
  ]);

  const doneMap: Record<string, boolean> = {
    student: students > 0,
    group: enrollments > 0,
    session: sessions > 0,
    attendance: attendance > 0,
    payment: payments > 0,
    notify: notifications > 0,
  };

  const steps = STEPS.map((s) => ({ ...s, done: doneMap[s.id] ?? false }));
  const progress = steps.filter((s) => s.done).length;
  const total = steps.length;
  const ob = (prefs.onboarding && typeof prefs.onboarding === "object")
    ? prefs.onboarding as { skipped?: boolean; skippedAt?: string }
    : {};

  return ok({
    enabled: true,
    skipped: ob.skipped === true,
    skippedAt: ob.skippedAt ?? null,
    progress,
    total,
    allDone: progress === total,
    level: levelOf(progress, total),
    steps,
  });
});

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  if (user.role === "TEACHER") throw new ApiError("رحلة البداية للإدارة والموظفين بس.", 403);
  await rateLimit(`onboarding:${user.id}`, 30, 60_000);

  const body = await readJson<{ action?: string }>(req);
  const action = body.action;
  if (action !== "skip" && action !== "restore") throw new ApiError("إجراء غير معروف.", 400);

  const prefs = await readPrefs(user.id);
  const next = {
    ...prefs,
    onboarding: {
      ...((prefs.onboarding && typeof prefs.onboarding === "object") ? prefs.onboarding as object : {}),
      skipped: action === "skip",
      skippedAt: action === "skip" ? new Date().toISOString() : null,
    },
  };

  await db.userPreference.upsert({
    where: { userId: user.id },
    update: { prefs: JSON.stringify(next) },
    create: { userId: user.id, theme: null, language: "ar", prefs: JSON.stringify(next) },
  });

  return ok({ skipped: action === "skip" });
});
