import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { todayStr, cairoDateStr, cairoDayBounds } from "@/lib/normalize";
import { expectedCash } from "@/lib/finance";

export const dynamic = "force-dynamic";

/** GET /api/dashboard — role-aware daily dashboard */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const centerId = user.centerId;
  const today = todayStr();

  const [todaySessions, cash, subscription, todaySlots] = await Promise.all([
    db.sessionInstance.findMany({
      where: { centerId, date: today },
      orderBy: { startTime: "asc" },
      include: {
        group: { include: { subject: true, grade: true, teacher: true } },
        _count: { select: { attendance: true } },
      },
    }),
    expectedCash(centerId, today),
    db.subscription.findUnique({
      where: { centerId },
      include: { plan: true },
    }),
    // Weekly-schedule slots for today (planned sessions not opened yet)
    db.scheduleSlot.findMany({
      where: { centerId, dayOfWeek: new Date(`${today}T12:00:00Z`).getUTCDay(), isActive: true },
      include: { group: { include: { subject: true, grade: true, teacher: true, _count: { select: { students: true } } } } },
      orderBy: { startTime: "asc" },
    }),
  ]);

  // Shared session cards (both roles)
  const sessions = todaySessions.map((s) => ({
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    room: s.room,
    status: s.status,
    subject: s.group.subject.name,
    grade: s.group.grade.name,
    groupName: s.group.name,
    teacher: s.group.teacher?.name ?? "—",
    teacherId: s.group.teacherId,
    price: s.price,
    presentCount: s._count.attendance,
    // وقت البداية الفعلي = لحظة فتح الحصة (مش وقت الجدول)
    openedAt: s.status !== "CANCELLED" ? s.createdAt.toISOString() : null,
    closedAggregates:
      s.status === "CLOSED"
        ? { totalRevenue: s.totalRevenue ?? 0, teacherShare: s.teacherShare ?? 0, centerShare: s.centerShare ?? 0, presentCount: s.presentCount ?? 0 }
        : null,
  }));

  // Planned sessions from the weekly schedule that are not opened yet —
  // so reception sees "2 sessions today" even before opening them.
  const plannedSessions = todaySlots
    .filter((slot) => !todaySessions.some((x) => x.scheduleId === slot.id))
    .map((slot) => ({
      scheduleId: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      room: slot.room,
      subject: slot.group.subject.name,
      grade: slot.group.grade.name,
      groupName: slot.group.name,
      teacher: slot.group.teacher?.name ?? "—",
      price: slot.group.sessionPrice,
      students: slot.group._count.students,
    }));

  const base = { today, sessions, plannedSessions, centerName: user.center!.name };

  if (user.role === "RECEPTIONIST") {
    // Simple payload: today's sessions + quick counts. No heavy analytics.
    return ok({
      ...base,
      role: "RECEPTIONIST",
      quickStats: {
        students: await db.student.count({ where: { centerId, status: "ACTIVE" } }),
      },
    });
  }

  // ===== ملخص تشغيلي للمدير: إيه اللي محتاج انتباه دلوقتي =====
  // (استعلامين groupBy بس — مش N استعلام لكل حصة)
  const todayIds = todaySessions.map((s) => s.id);
  const [chargedAgg, paidAgg, pendingApprovals] = await Promise.all([
    db.attendance.groupBy({ by: ["sessionId"], _sum: { charged: true }, where: { sessionId: { in: todayIds } } }),
    db.studentTransaction.groupBy({ by: ["sessionId"], _sum: { amount: true }, where: { sessionId: { in: todayIds }, type: "PAYMENT" } }),
    db.approvalRequest.count({ where: { centerId, status: "PENDING" } }),
  ]);
  const chargedMap = new Map(chargedAgg.map((a) => [a.sessionId, a._sum.charged ?? 0]));
  const paidMap = new Map(paidAgg.map((a) => [a.sessionId, a._sum.amount ?? 0]));
  // حصات محتاجة انتباه: مفتوحة ووقتها خلص (محتاجة قفل) — الوقت شغال على السيرفر
  const { nowHM: serverNow } = await import("@/lib/normalize");
  const nowRef = serverNow();
  const attention = todaySessions
    .filter((s) => s.status === "OPEN" && s.endTime < nowRef)
    .map((s) => ({ id: s.id, subject: s.group.subject.name, groupName: s.group.name, endTime: s.endTime }));
  const paymentIssues = todaySessions
    .filter((s) => {
      if (s.status === "CANCELLED") return false;
      const charged = chargedMap.get(s.id) ?? 0;
      const paid = paidMap.get(s.id) ?? 0;
      return charged > 0 && charged - paid > 0;
    })
    .map((s) => ({ id: s.id, subject: s.group.subject.name, groupName: s.group.name, outstanding: (chargedMap.get(s.id) ?? 0) - (paidMap.get(s.id) ?? 0) }));

  const opsSummary = {
    activeSessions: todaySessions.filter((s) => s.status === "OPEN").length,
    attention,
    pendingApprovals,
    paymentIssues,
  };

  // ===== Manager analytics =====
  const startOfMonth = today.slice(0, 8) + "01";
  // حدود يوم القاهرة بالظبط — عشان دفعات بعد نص الليل تتحسب في يومها
  const { start: dayStart, end: dayEnd } = cairoDayBounds(today);

  const [
    activeStudents,
    attendanceToday,
    collectedTodayRows,
    monthRevenueAgg,
    monthExpensesAgg,
    monthTeacherShareAgg,
    outstandingAgg,
    creditAgg,
    teacherPayables,
  ] = await Promise.all([
    db.student.count({ where: { centerId, status: "ACTIVE" } }),
    db.attendance.count({ where: { centerId, session: { date: today }, status: { in: ["PRESENT", "LATE"] } } }),
    db.studentTransaction.findMany({ where: { centerId, type: "PAYMENT", createdAt: { gte: dayStart, lte: dayEnd } }, select: { amount: true, createdAt: true } }),
    db.sessionInstance.aggregate({ _sum: { totalRevenue: true, teacherShare: true, centerShare: true }, where: { centerId, status: "CLOSED", date: { gte: startOfMonth, lte: today } } }),
    db.expense.aggregate({ _sum: { amount: true }, where: { centerId, date: { gte: startOfMonth, lte: today } } }),
    db.teacherSettlement.aggregate({ _sum: { amount: true }, where: { centerId, type: "EARNED", date: { gte: startOfMonth, lte: today } } }),
    db.studentTransaction.aggregate({ _sum: { amount: true }, where: { centerId, type: "CHARGE" } }),
    db.studentTransaction.aggregate({ _sum: { amount: true }, where: { centerId } }),
    db.teacherSettlement.groupBy({ by: ["teacherId"], _sum: { amount: true }, where: { centerId } }),
  ]);

  const paymentsAll = (creditAgg._sum.amount ?? 0);
  // فلترة دقيقة بتاريخ القاهرة — عشان دفعات بعد نص الليل تتحسب في يومها
  const collectedToday = collectedTodayRows
    .filter((t) => cairoDateStr(t.createdAt) === today)
    .reduce((a, t) => a + t.amount, 0);
  const chargesAll = Math.abs(outstandingAgg._sum.amount ?? 0);
  const netStudentBalance = paymentsAll + (outstandingAgg._sum.amount ?? 0); // payments are +, charges are -
  const totalOwed = Math.max(-netStudentBalance, 0); // students owe center
  const totalCredit = Math.max(netStudentBalance, 0); // center owes students

  // Teacher payables map
  const teacherIds = teacherPayables.map((t) => t.teacherId);
  const teachers = await db.teacher.findMany({ where: { id: { in: teacherIds }, centerId } });
  const teacherList = teacherPayables
    .map((t) => {
      const teacher = teachers.find((x) => x.id === t.teacherId);
      return teacher ? { id: teacher.id, name: teacher.name, payable: t._sum.amount ?? 0 } : null;
    })
    .filter(Boolean);

  // Alerts
  const alerts: { level: "warn" | "info"; text: string }[] = [];
  const daysToRenewal = subscription ? Math.ceil((new Date(subscription.renewalDate).getTime() - new Date(today).getTime()) / 86400000) : null;
  if (subscription && (subscription.status === "EXPIRED" || daysToRenewal !== null && daysToRenewal <= 7)) {
    alerts.push({
      level: "warn",
      text: subscription.status === "EXPIRED"
        ? "اشتراك السنتر منتهي — جدد من إدارة النخبة."
        : `اشتراك السنتر بينتهي بعد ${daysToRenewal} يوم (${subscription.renewalDate}).`,
    });
  }
  if (cash.cashDay?.countedCash != null) {
    const diff = cash.cashDay.countedCash - cash.expected;
    if (diff !== 0) alerts.push({ level: "warn", text: `فرق الصندوق النهاردة: ${(diff / 100).toLocaleString("en-EG")} جنيه` });
  }

  return ok({
    ...base,
    role: "MANAGER",
    opsSummary,
    quickStats: { students: activeStudents },
    stats: {
      attendanceToday,
      collectedToday,
      monthRevenue: monthRevenueAgg._sum.totalRevenue ?? 0,
      monthTeacherShare: monthRevenueAgg._sum.teacherShare ?? 0,
      monthCenterShare: monthRevenueAgg._sum.centerShare ?? 0,
      monthExpenses: monthExpensesAgg._sum.amount ?? 0,
      monthNet: (monthRevenueAgg._sum.centerShare ?? 0) - (monthExpensesAgg._sum.amount ?? 0),
      totalOwed,
      totalCredit,
      activeStudents,
      chargesAll,
      paymentsAll,
    },
    cash: {
      opening: cash.opening,
      cashIn: cash.cashIn,
      cashOut: cash.cashOut,
      expected: cash.expected,
      status: cash.cashDay?.status ?? "NONE",
      counted: cash.cashDay?.countedCash ?? null,
      difference: cash.cashDay?.countedCash != null ? cash.cashDay.countedCash - cash.expected : null,
    },
    teacherPayables: teacherList,
    subscription: subscription
      ? { plan: subscription.plan.name, status: subscription.status, renewalDate: subscription.renewalDate, pricePerStudent: subscription.pricePerStudent }
      : null,
    alerts,
  });
});
