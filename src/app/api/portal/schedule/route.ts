import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { todayStr, dayNameAR } from "@/lib/normalize";
import { getPortalStudent } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

// ============================= أقرب حصة =============================

export type NextLesson = {
  date: string; dayName: string; startTime: string; endTime: string;
  subject: string; groupName: string; gradeName: string;
  teacher: string | null; room: string | null; isToday: boolean; isNow: boolean;
};

/** أقرب حصة للطالب من: حصص اليوم الجارية/الجاية + الجدول الأسبوعي (أقرب تاريخ جاي) */
export async function computeNextLesson(studentId: string): Promise<NextLesson | null> {
  const regs = await db.studentGroup.findMany({
    where: { studentId, status: "ACTIVE" },
    select: { group: { include: { subject: true, grade: true, teacher: true } } },
  });
  if (regs.length === 0) return null;
  const centerId = regs[0].group.centerId;
  const groupIds = regs.map((r) => r.group.id);
  const groupById = new Map(regs.map((r) => [r.group.id, r.group]));

  const today = todayStr();
  const nowHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();

  // 1) حصص اليوم الفعلية (المفتوحة) — أقوى من الجدول
  const todaySessions = await db.sessionInstance.findMany({
    where: { centerId, date: today, groupId: { in: groupIds }, status: "OPEN" },
    orderBy: { startTime: "asc" },
  });
  const nowSession = todaySessions.find((s) => s.startTime <= nowHM && s.endTime > nowHM);
  const upcomingSession = todaySessions.find((s) => s.startTime > nowHM);
  const pick = nowSession ?? upcomingSession;
  if (pick) {
    const g = groupById.get(pick.groupId)!;
    return {
      date: today, dayName: "النهاردة", startTime: pick.startTime, endTime: pick.endTime,
      subject: g.subject.name, groupName: g.name, gradeName: g.grade.name,
      teacher: g.teacher?.name ?? null, room: pick.room ?? g.room ?? null,
      isToday: true, isNow: !!nowSession && pick.id === nowSession.id,
    };
  }

  // 2) الجدول الأسبوعي — أقرب خانة جاية خلال 7 أيام
  const slots = await db.scheduleSlot.findMany({
    where: { groupId: { in: groupIds }, isActive: true },
    orderBy: { startTime: "asc" },
  });
  if (slots.length === 0) return null;

  const DAY_MS = 86400000;
  let best: { slot: (typeof slots)[number]; date: string } | null = null;
  for (let add = 0; add < 7; add++) {
    const d = new Date(new Date(`${today}T12:00:00Z`).getTime() + add * DAY_MS);
    const dow = d.getUTCDay();
    const dateStr = d.toISOString().slice(0, 10);
    const daySlots = slots.filter((s) => s.dayOfWeek === dow && s.groupId !== null);
    for (const slot of daySlots) {
      if (add === 0 && slot.startTime <= nowHM) continue; // فاتت النهاردة
      if (!best || slot.startTime < best.slot.startTime) best = { slot, date: dateStr };
    }
    if (best) break; // أول يوم فيه حصة كفاية
  }
  if (!best) return null;
  const g = groupById.get(best.slot.groupId);
  if (!g) return null;
  return {
    date: best.date,
    dayName: best.date === today ? "النهاردة" : dayNameAR(new Date(`${best.date}T12:00:00Z`).getUTCDay()),
    startTime: best.slot.startTime, endTime: best.slot.endTime,
    subject: g.subject.name, groupName: g.name, gradeName: g.grade.name,
    teacher: g.teacher?.name ?? null, room: best.slot.room ?? g.room ?? null,
    isToday: best.date === today, isNow: false,
  };
}

// ============================= مطابقة الإعلانات للطالب =============================

export async function latestAnnouncementsFor(
  studentId: string,
  centerId: string,
  gradeId: string | null,
  limit: number,
) {
  const [regs, all] = await Promise.all([
    db.studentGroup.findMany({
      where: { studentId, status: "ACTIVE" },
      select: { groupId: true, group: { select: { subjectId: true } } },
    }),
    db.announcement.findMany({
      where: { centerId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);
  const groupIds = new Set(regs.map((r) => r.groupId));
  const subjectIds = new Set(regs.map((r) => r.group.subjectId));
  const relevant = all.filter((a) => {
    if (a.audienceType === "ALL") return true;
    if (a.audienceType === "GRADE") return !!gradeId && a.audienceId === gradeId;
    if (a.audienceType === "GROUP") return groupIds.has(a.audienceId ?? "");
    if (a.audienceType === "SUBJECT") return subjectIds.has(a.audienceId ?? "");
    return false;
  });
  return relevant.slice(0, limit);
}

// ============================= GET — جدولي الأسبوعي =============================

export const GET = handler(async () => {
  const student = await getPortalStudent();
  if (!student) return ok({ student: null });

  const regs = await db.studentGroup.findMany({
    where: { studentId: student.id, status: "ACTIVE" },
    include: { group: { include: { subject: true, grade: true, teacher: true } } },
  });

  const groupIds = regs.map((r) => r.group.id);
  const slots = groupIds.length
    ? await db.scheduleSlot.findMany({
        where: { groupId: { in: groupIds }, isActive: true },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      })
    : [];

  const groupById = new Map(regs.map((r) => [r.group.id, r.group]));
  const today = todayStr();
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nowHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

  // جدول الأسبوع: 7 أيام من الأحد للسبت
  const week = Array.from({ length: 7 }, (_, i) => {
    const dow = (i + 0) % 7; // 0=الأحد
    const daySlots = slots.filter((s) => s.dayOfWeek === dow);
    return {
      dow,
      dayName: dayNameAR(dow),
      isToday: dow === todayDow,
      lessons: daySlots.map((s) => {
        const g = groupById.get(s.groupId);
        return {
          subject: g?.subject.name ?? "",
          groupName: g?.name ?? "",
          gradeName: g?.grade.name ?? "",
          teacher: g?.teacher?.name ?? null,
          room: s.room ?? g?.room ?? null,
          startTime: s.startTime,
          endTime: s.endTime,
          isPast: dow === todayDow && s.endTime < nowHM,
          isNow: dow === todayDow && s.startTime <= nowHM && s.endTime > nowHM,
        };
      }),
    };
  });

  const nextLesson = await computeNextLesson(student.id);

  return ok({
    student: { name: student.name, code: student.code, gradeName: student.gradeName, center: student.center },
    today,
    week,
    nextLesson,
    subjects: regs.map((r) => r.group.subject.name),
    empty: slots.length === 0,
  });
});
