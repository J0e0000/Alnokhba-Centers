import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { todayStr, cairoDateStr, cairoDayBounds } from "@/lib/normalize";
import { expectedCash } from "@/lib/finance";

export const dynamic = "force-dynamic";

// =====micro-cache للداشبورد (15 ثانية لكل سنتر+رول) =====
// الداشبورد بيسأل ~15 استعلام — مع أي burst من الموظفين بيحرق connection pool
// (ده اللي كان مسبب pool timeouts تحت الحمل). كاش 15s بيكسر الـ bursts
// والأرقام المالية على الداشبورد بتفضل عمليّة — صفحة الفلوس نفسها دايمًا live.
type DashEntry = { at: number; payload: unknown };
const dashCache = new Map<string, DashEntry>();
const DASH_TTL_MS = 15_000;

/** GET /api/dashboard — role-aware daily dashboard */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const centerId = user.centerId;
  const today = todayStr();

  // 1) كاش-hit؟ رجّعه فورًا — بيحمي الداتابيز من الـ bursts
  const cacheKey = `${centerId}:${user.role}`;
  const hit = dashCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DASH_TTL_MS) return ok(hit.payload);

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
    subject: s.group?.subject.name ?? s.name ?? "حصة",
    grade: s.group?.grade.name ?? "—",
    groupName: s.group?.name ?? "—",
    teacher: s.group?.teacher?.name ?? "—",
    teacherId: s.group?.teacherId ?? null,
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
    const payload = {
      ...base,
      role: "RECEPTIONIST",
      quickStats: {
        students: await db.student.count({ where: { centerId, status: "ACTIVE" } }),
      },
    };
    dashCache.set(cacheKey, { at: Date.now(), payload });
    return ok(payload);
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
    .map((s) => ({ id: s.id, subject: s.group?.subject.name ?? s.name ?? "حصة", groupName: s.group?.name ?? "—", endTime: s.endTime }));
  const paymentIssues = todaySessions
    .filter((s) => {
      if (s.status === "CANCELLED") return false;
      const charged = chargedMap.get(s.id) ?? 0;
      const paid = paidMap.get(s.id) ?? 0;
      return charged > 0 && charged - paid > 0;
    })
    .map((s) => ({ id: s.id, subject: s.group?.subject.name ?? s.name ?? "حصة", groupName: s.group?.name ?? "—", outstanding: (chargedMap.get(s.id) ?? 0) - (paidMap.get(s.id) ?? 0) }));

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
    ledgerByType,
    teacherPayables,
  ] = await Promise.all([
    db.student.count({ where: { centerId, status: "ACTIVE" } }),
    db.attendance.count({ where: { centerId, session: { date: today }, status: { in: ["PRESENT", "LATE"] } } }),
    db.studentTransaction.findMany({ where: { centerId, type: "PAYMENT", createdAt: { gte: dayStart, lte: dayEnd } }, select: { amount: true, createdAt: true } }),
    db.sessionInstance.aggregate({ _sum: { totalRevenue: true, teacherShare: true, centerShare: true }, where: { centerId, status: "CLOSED", date: { gte: startOfMonth, lte: today } } }),
    db.expense.aggregate({ _sum: { amount: true }, where: { centerId, date: { gte: startOfMonth, lte: today } } }),
    db.teacherSettlement.aggregate({ _sum: { amount: true }, where: { centerId, type: "EARNED", date: { gte: startOfMonth, lte: today } } }),
    // استعلام واحد groupBy بالنويع بدل full-scan اتنين (CHARGE + الكل) — نص الحمل بالظبط
    db.studentTransaction.groupBy({ by: ["type"], _sum: { amount: true }, where: { centerId } }),
    db.teacherSettlement.groupBy({ by: ["teacherId"], _sum: { amount: true }, where: { centerId } }),
  ]);

  // نفس أرقام الكود القديم بالظبط — بس من groupBy واحد:
  // outstandingAgg = مجموع CHARGE (سالب) / creditAgg = مجموع كل الأنواع (الصافي)
  const chargeSum = ledgerByType.find((g) => g.type === "CHARGE")?._sum.amount ?? 0;
  const allSum = ledgerByType.reduce((a, g) => a + (g._sum.amount ?? 0), 0);
  const paymentsAll = allSum;
  const chargesAll = Math.abs(chargeSum);
  const netStudentBalance = allSum + chargeSum; // payments are +, charges are -
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

  // فلترة دقيقة بتاريخ القاهرة — عشان دفعات بعد نص الليل تتحسب في يومها
  const collectedToday = collectedTodayRows
    .filter((t) => cairoDateStr(t.createdAt) === today)
    .reduce((a, t) => a + t.amount, 0);

  // ===== OPTIONAL INSIGHT — حضور آخر ٧ أيام مقابل الأسبوع اللي قبله =====
  // استعلام واحد على الفهرس (centerId+date) + استعلام اسم مجموعة واحد بس لو فيه نزول فعلي.
  let insight: {
    thisWeek: number; prevWeek: number; changePct: number | null;
    topDrop: { label: string; changePct: number } | null;
  } | null = null;
  try {
    const dRef = new Date(`${today}T12:00:00Z`);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const d7 = iso(new Date(dRef.getTime() - 7 * 86400000));
    const d14 = iso(new Date(dRef.getTime() - 14 * 86400000));
    const recent = await db.sessionInstance.findMany({
      where: { centerId, date: { gte: d14, lte: today }, status: { not: "CANCELLED" } },
      select: { date: true, groupId: true, _count: { select: { attendance: true } } },
    });
    let thisWeek = 0, prevWeek = 0;
    const gThis = new Map<string, number>(), gPrev = new Map<string, number>();
    for (const s of recent) {
      const n = s._count.attendance;
      if (s.date > d7) { thisWeek += n; if (s.groupId) gThis.set(s.groupId, (gThis.get(s.groupId) ?? 0) + n); }
      else { prevWeek += n; if (s.groupId) gPrev.set(s.groupId, (gPrev.get(s.groupId) ?? 0) + n); }
    }
    const changePct = prevWeek > 0 ? Math.round(((thisWeek - prevWeek) / prevWeek) * 100) : null;
    // المجموعة الأكثر تأثرًا: أكبر نزول مع عينة معقولة (≥3 في الأسبوع القبلي) — من غير ضجيج
    let topDrop: { label: string; changePct: number } | null = null;
    if (changePct !== null && changePct < 0) {
      let worst: { id: string; pct: number } | null = null;
      for (const [gid, prevN] of gPrev) {
        if (prevN < 3) continue;
        const thisN = gThis.get(gid) ?? 0;
        if (thisN >= prevN) continue;
        const pct = Math.round(((thisN - prevN) / prevN) * 100);
        if (!worst || pct < worst.pct) worst = { id: gid, pct };
      }
      if (worst) {
        const g = await db.group.findUnique({
          where: { id: worst.id },
          select: { name: true, subject: { select: { name: true } }, grade: { select: { name: true } } },
        });
        if (g) topDrop = { label: `${g.subject.name} — ${g.grade.name} ${g.name}`.trim(), changePct: worst.pct };
      }
    }
    insight = { thisWeek, prevWeek, changePct, topDrop };
  } catch { /* insight تحليلية بس — مينفعش تكسر الداشبورد */ }

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

  const managerPayload = {
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
    insight,
  };
  dashCache.set(cacheKey, { at: Date.now(), payload: managerPayload });
  return ok(managerPayload);
});
