import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { todayStr, dayNameAR } from "@/lib/normalize";
import { getPortalTeacher } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

// ============================= GET — جدولي الأسبوعي =============================

export const GET = handler(async () => {
  const teacher = await getPortalTeacher();
  if (!teacher) return ok({ teacher: null });

  const groups = await db.group.findMany({
    where: { teacherId: teacher.id, isActive: true },
    include: { subject: true, grade: true },
  });
  const groupIds = groups.map((g) => g.id);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const slots = groupIds.length
    ? await db.scheduleSlot.findMany({
        where: { groupId: { in: groupIds }, isActive: true },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      })
    : [];

  const today = todayStr();
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nowHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

  const week = Array.from({ length: 7 }, (_, i) => {
    const dow = i % 7; // 0=الأحد
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
          room: s.room ?? g?.room ?? null,
          startTime: s.startTime,
          endTime: s.endTime,
          isPast: dow === todayDow && s.endTime < nowHM,
          isNow: dow === todayDow && s.startTime <= nowHM && s.endTime > nowHM,
        };
      }),
    };
  });

  return ok({
    teacher: { name: teacher.name, center: teacher.center },
    today,
    week,
    subjects: groups.map((g) => g.subject.name),
    empty: slots.length === 0,
  });
});
