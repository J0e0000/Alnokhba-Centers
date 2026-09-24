import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { todayStr } from "@/lib/normalize";
import { getPortalTeacher } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

// ============================= GET — فلوسي (المستحقات والتسويات) =============================

export const GET = handler(async () => {
  const teacher = await getPortalTeacher();
  if (!teacher) return ok({ teacher: null });

  const today = todayStr();
  const monthStart = `${today.slice(0, 7)}-01`;

  // الإحصائيات من كل الحركات (مش آخر 150 بس)
  const [agg, monthAgg, groups, settlements] = await Promise.all([
    db.teacherSettlement.groupBy({
      by: ["type"],
      where: { teacherId: teacher.id },
      _sum: { amount: true },
    }),
    db.teacherSettlement.aggregate({
      where: { teacherId: teacher.id, type: "EARNED", date: { gte: monthStart } },
      _sum: { amount: true },
    }),
    db.group.findMany({
      where: { teacherId: teacher.id, isActive: true },
      select: { id: true, name: true, sessionPrice: true, teacherPercent: true, subject: { select: { name: true } } },
    }),
    db.teacherSettlement.findMany({
      where: { teacherId: teacher.id },
      orderBy: { createdAt: "desc" },
      take: 150,
    }),
  ]);

  const earnedSum = agg.find((a) => a.type === "EARNED")?._sum.amount ?? 0;
  const paidSum = agg.find((a) => a.type === "PAID")?._sum.amount ?? 0; // سالب
  const balance = earnedSum + paidSum;
  const thisMonthEarned = monthAgg._sum.amount ?? 0;

  // بيانات الحصص المرتبطة بالتسويات (sessionId عمود نصي من غير relation)
  const sessIds = [...new Set(settlements.map((s) => s.sessionId).filter((x): x is string => !!x))];
  const sessions = sessIds.length
    ? await db.sessionInstance.findMany({
        where: { id: { in: sessIds } },
        select: { id: true, date: true, startTime: true, endTime: true },
      })
    : [];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  return ok({
    teacher: { name: teacher.name, center: teacher.center },
    today,
    stats: { balance, totalEarned: earnedSum, totalPaid: -paidSum, thisMonthEarned },
    settlements: settlements.map((s) => {
      const sess = s.sessionId ? sessionById.get(s.sessionId) : null;
      return {
        id: s.id,
        type: s.type,
        amount: s.amount,
        date: s.date,
        note: s.note,
        sessionDate: sess?.date ?? null,
        sessionTime: sess ? `${sess.startTime}-${sess.endTime}` : null,
      };
    }),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      subject: g.subject.name,
      price: g.sessionPrice,
      teacherPercent: g.teacherPercent,
    })),
  });
});
