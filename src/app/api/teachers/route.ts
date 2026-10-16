import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { dayNameAR } from "@/lib/normalize";

export const dynamic = "force-dynamic";

const DAY_IDX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** اليوم والساعة الحاليين بتوقيت القاهرة (DST-safe عبر Intl) */
function cairoNow(): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { dow: DAY_IDX[wd] ?? 0, minutes: hh * 60 + mm };
}

/**
 * GET /api/teachers — تاب «المدرسين»: كارت واحد لكل مدرس فيه:
 * - حصته الجاية (حضرتك جاي إمتى) + عدد الطلاب فيها (عدد الطلاب فيها كذا)
 * - حصص الأسبوع وإجمالي طلابه
 * - مستحقاته (للمدير بس — بيانات مالية حساسة)
 * المدير والاستقبال — بيانات الجدول متاحة لأي موظف سنتر.
 */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const isManager = user.role === "MANAGER";

  const [teachers, slots, grouped] = await Promise.all([
    db.teacher.findMany({ where: { centerId: user.centerId }, orderBy: { name: "asc" } }),
    db.scheduleSlot.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: {
        group: {
          include: {
            subject: true, grade: true,
            _count: { select: { students: true } },
          },
        },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    isManager
      ? db.teacherSettlement.groupBy({
          by: ["teacherId"],
          _sum: { amount: true },
          where: { centerId: user.centerId },
        })
      : Promise.resolve([] as { teacherId: string; _sum: { amount: number | null } }[]),
  ]);

  const { dow: todayDow, minutes: nowMin } = cairoNow();

  const rows = teachers.map((t) => {
    const mySlots = slots.filter((s) => s.group?.teacherId === t.id);

    // الحصة الجاية: أقرب slot بالأسبوع (النهاردة لو لسه ماتجتش، وإلا أقرب يوم جاي)
    let next: (typeof mySlots)[number] | null = null;
    let nextOrder = 99;
    let nextIsToday = false;
    for (const s of mySlots) {
      const order = (s.dayOfWeek - todayDow + 7) % 7;
      const isToday = order === 0 && toMin(s.startTime) > nowMin;
      if (isToday) { next = s; nextOrder = 0; nextIsToday = true; break; }
      const weekOrder = order === 0 ? 7 : order; // نفس اليوم بس عدّى وقته = الأسبوع الجاي
      if (weekOrder < nextOrder) { next = s; nextOrder = weekOrder; nextIsToday = false; }
    }

    // المجموعات الفريدة (المدرس ممكن يدرّس نفس المجموعة أكتر من يوم)
    const groupMap = new Map<string, { name: string; students: number; subject: string; grade: string }>();
    for (const s of mySlots) {
      if (!s.group || groupMap.has(s.groupId)) continue;
      groupMap.set(s.groupId, {
        name: s.group.name,
        students: s.group._count.students,
        subject: s.group.subject.name,
        grade: s.group.grade.name,
      });
    }
    const groups = [...groupMap.values()];
    const subjects = [...new Set(groups.map((g) => g.subject))];
    const grades = [...new Set(groups.map((g) => g.grade))];
    const totalStudents = groups.reduce((sum, g) => sum + g.students, 0);

    return {
      id: t.id,
      name: t.name,
      phone: t.phone,
      isActive: t.isActive,
      subjects,
      grades,
      groups: groups.map((g) => g.name),
      weeklySessions: mySlots.length,
      totalStudents,
      next: next && next.group
        ? {
            dayOfWeek: next.dayOfWeek,
            dayName: dayNameAR(next.dayOfWeek),
            isToday: nextIsToday,
            startTime: next.startTime,
            endTime: next.endTime,
            room: next.room || next.group.room || null,
            groupName: next.group.name,
            grade: next.group.grade.name,
            subject: next.group.subject.name,
            students: next.group._count.students,
            inDays: nextOrder,
          }
        : null,
      payable: isManager ? (grouped.find((g) => g.teacherId === t.id)?._sum.amount ?? 0) : undefined,
    };
  });

  // ترتيب: اللي عنده حصة النهاردة الأول، ثم حسب أقرب حصة، ثم الاسم
  rows.sort((a, b) => {
    const ao = a.next ? (a.next.isToday ? 0 : a.next.inDays) : 99;
    const bo = b.next ? (b.next.isToday ? 0 : b.next.inDays) : 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, "ar");
  });

  return ok({
    today: dayNameAR(todayDow),
    teachers: rows,
    summary: {
      total: rows.length,
      active: rows.filter((t) => t.isActive).length,
      weeklySessions: rows.reduce((s, t) => s + t.weeklySessions, 0),
      pendingDues: isManager ? rows.reduce((s, t) => s + (t.payable ?? 0), 0) : undefined,
    },
  });
});
