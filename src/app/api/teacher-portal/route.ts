import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { todayStr, dayNameAR } from "@/lib/normalize";
import {
  getPortalTeacher, createTeacherSession, destroyTeacherSession, verifyTeacherLogin,
} from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

// ============================= GET — بيانات الرئيسية =============================

export const GET = handler(async () => {
  const teacher = await getPortalTeacher();
  if (!teacher) return ok({ teacher: null });

  const today = todayStr();
  const nowHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();

  // مجموعات المدرس
  const groups = await db.group.findMany({
    where: { teacherId: teacher.id, isActive: true },
    include: { subject: true, grade: true },
  });
  const groupIds = groups.map((g) => g.id);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // حصص اليوم الفعلية (لمجموعات المدرس)
  const todaySessions = groupIds.length
    ? await db.sessionInstance.findMany({
        where: { centerId: teacher.centerId, date: today, groupId: { in: groupIds } },
        orderBy: { startTime: "asc" },
      })
    : [];

  // خانات جدول اليوم (من غير حصص فعلية) — عشان المدرس يشوف اللي مجدول ومفتحش لسه
  const todaySlots = groupIds.length
    ? (await db.scheduleSlot.findMany({
        where: { groupId: { in: groupIds }, dayOfWeek: todayDow, isActive: true },
        orderBy: { startTime: "asc" },
      })).filter((s) => !todaySessions.some((i) => i.scheduleId === s.id))
    : [];

  // أعداد الحضور
  const attendanceCounts = new Map<string, number>();
  if (todaySessions.length) {
    const att = await db.attendance.groupBy({
      by: ["sessionId"],
      where: { sessionId: { in: todaySessions.map((s) => s.id) } },
      _count: true,
    });
    for (const a of att) attendanceCounts.set(a.sessionId, a._count);
  }

  // أقرب حصة جاية (من جدول الأسبوع)
  const slots = groupIds.length
    ? await db.scheduleSlot.findMany({ where: { groupId: { in: groupIds }, isActive: true }, orderBy: { startTime: "asc" } })
    : [];
  const DAY_MS = 86400000;
  let nextLesson: { date: string; dayName: string; startTime: string; endTime: string; subject: string; groupName: string; room: string | null } | null = null;
  for (let add = 0; add < 7 && !nextLesson; add++) {
    const d = new Date(new Date(`${today}T12:00:00Z`).getTime() + add * DAY_MS);
    const dow = d.getUTCDay();
    const dateStr = d.toISOString().slice(0, 10);
    for (const s of slots.filter((x) => x.dayOfWeek === dow)) {
      if (add === 0 && s.endTime <= nowHM) continue;
      const g = groupById.get(s.groupId);
      if (!g) continue;
      nextLesson = {
        date: dateStr, dayName: dateStr === today ? "النهاردة" : dayNameAR(dow),
        startTime: s.startTime, endTime: s.endTime,
        subject: g.subject.name, groupName: g.name, room: s.room ?? g.room ?? null,
      };
      break;
    }
  }

  // المستحقات والإحصائيات
  const [settlements, studentCount] = await Promise.all([
    db.teacherSettlement.findMany({
      where: { teacherId: teacher.id },
      select: { type: true, amount: true },
    }),
    db.studentGroup.count({ where: { groupId: { in: groupIds }, status: "ACTIVE" } }),
  ]);
  const balance = settlements.reduce((a, s) => a + s.amount, 0);
  const totalEarned = settlements.filter((s) => s.type === "EARNED").reduce((a, s) => a + s.amount, 0);
  const monthSettlements = await db.teacherSettlement.findMany({
    where: { teacherId: teacher.id, type: "EARNED", date: { gte: `${today.slice(0, 7)}-01` } },
    select: { amount: true },
  });
  const thisMonthEarned = monthSettlements.reduce((a, s) => a + s.amount, 0);

  return ok({
    teacher: {
      id: teacher.id,
      name: teacher.name,
      center: teacher.center,
    },
    today,
    todaySessions: todaySessions.map((s) => {
      const g = groupById.get(s.groupId);
      return {
        id: s.id,
        subject: g?.subject.name ?? "",
        groupName: g?.name ?? "",
        gradeName: g?.grade.name ?? "",
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room ?? g?.room ?? null,
        status: s.status,
        attendanceCount: attendanceCounts.get(s.id) ?? (s.presentCount ?? 0),
      };
    }),
    todayScheduled: todaySlots.map((s) => {
      const g = groupById.get(s.groupId);
      return {
        subject: g?.subject.name ?? "",
        groupName: g?.name ?? "",
        gradeName: g?.grade.name ?? "",
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room ?? g?.room ?? null,
      };
    }),
    nextLesson,
    stats: {
      groups: groups.length,
      students: studentCount,
      balance,
      thisMonthEarned,
      totalEarned,
    },
  });
});

// ============================= POST — دخول / خروج =============================

type LoginBody = { action?: string; code?: string; phone?: string };

export const POST = handler(async (req: Request) => {
  const body = await readJson<LoginBody>(req);

  if (body.action === "logout") {
    await destroyTeacherSession();
    return ok({ ok: true });
  }

  if (body.action !== "login") throw new ApiError("طلب غير معروف.", 400);

  // rate-limit مزدوج: 12 محاولة/10 دقايق لكل IP + 6 محاولات/10 دقايق لكل كود
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  rateLimit(`teacher-portal-login:${ip}`, 12, 600_000);
  const codeKey = String(body.code ?? "").replace(/\D/g, "").slice(-4);
  if (codeKey) rateLimit(`teacher-login-code:${codeKey}`, 6, 600_000);

  const result = await verifyTeacherLogin(String(body.phone ?? ""), String(body.code ?? ""));
  if (!result.ok) throw new ApiError(result.error, 401);

  await createTeacherSession(result.teacherId);
  return ok({ ok: true });
});
