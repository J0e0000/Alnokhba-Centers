import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deriveSubStatus } from "@/lib/subscription";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics — تحليلات منصة النخبة (spec §8):
 * فهم البيزنس مش مجرد عدّادات — نمو، إيراد، تجديدات، اشتراكات مستحقة.
 */
export const GET = handler(async () => {
  await requireAdmin();

  const since12 = new Date(Date.now() - 365 * 86400000);

  const [centers, billings, studentsTotal, renewEvents, subs] = await Promise.all([
    db.center.findMany({
      select: {
        id: true, name: true, status: true, createdAt: true,
        subscription: { select: { id: true, status: true, renewalDate: true, trialEndsAt: true, graceUntil: true } },
        _count: { select: { students: { where: { status: { not: "ARCHIVED" } } }, users: true } },
      },
    }),
    db.platformBilling.findMany({
      where: { createdAt: { gte: since12 } },
      select: { amount: true, status: true, createdAt: true, periodStart: true, periodEnd: true },
    }),
    db.student.count({ where: { status: { not: "ARCHIVED" } } }),
    db.subscriptionEvent.findMany({
      where: { type: "RENEWED", createdAt: { gte: since12 } },
      select: { amount: true, createdAt: true },
    }),
    db.subscription.findMany({ select: { id: true, status: true, renewalDate: true, trialEndsAt: true, graceUntil: true, centerId: true } }),
  ]);

  // ===== تجميع شهري (آخر 12 شهر) =====
  const monthKey = (d: Date | string) => {
    const x = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
  };
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthMap = <T,>(fill: T) => Object.fromEntries(months.map((m) => [m, fill])) as Record<string, T>;

  const revenueByMonth = monthMap<number>(0);
  for (const b of billings) {
    if (b.status !== "PAID") continue;
    const k = monthKey(b.createdAt);
    if (k in revenueByMonth) revenueByMonth[k] += b.amount;
  }

  const centersGrowth = monthMap<number>(0);
  for (const c of centers) {
    const k = monthKey(c.createdAt);
    if (k in centersGrowth) centersGrowth[k] += 1;
  }

  const renewalsByMonth = monthMap<number>(0);
  for (const e of renewEvents) {
    const k = monthKey(e.createdAt);
    if (k in renewalsByMonth) renewalsByMonth[k] += 1;
  }
  const renewalRevenueByMonth = monthMap<number>(0);
  for (const e of renewEvents) {
    const k = monthKey(e.createdAt);
    if (k in renewalRevenueByMonth) renewalRevenueByMonth[k] += e.amount ?? 0;
  }

  // ===== حالات الاشتراكات (الحالة المحسوبة) =====
  const derived = subs.map((s) => ({ ...s, eff: deriveSubStatus(s).effective }));
  const subCounts = {
    TRIAL: derived.filter((s) => s.eff === "TRIAL").length,
    ACTIVE: derived.filter((s) => s.eff === "ACTIVE").length,
    GRACE: derived.filter((s) => s.eff === "GRACE").length,
    EXPIRED: derived.filter((s) => s.eff === "EXPIRED").length,
    CANCELLED: derived.filter((s) => s.eff === "CANCELLED").length,
  };

  // ===== اشتراكات قريبة من الانتهاء (30 يوم) =====
  const expiringSoon = derived
    .filter((s) => ["ACTIVE", "TRIAL", "GRACE"].includes(s.eff) && deriveSubStatus(s).daysLeft <= 30)
    .map((s) => {
      const c = centers.find((x) => x.id === s.centerId);
      return {
        centerId: s.centerId, centerName: c?.name ?? "—",
        status: s.eff, renewalDate: s.renewalDate,
        daysLeft: deriveSubStatus(s).daysLeft,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 12);

  // ===== مستحقات غير محصلة =====
  const outstanding = billings.filter((b) => b.status === "PENDING");
  const outstandingTotal = outstanding.reduce((a, b) => a + b.amount, 0);

  // ===== أكبر السناتر في عدد الطلاب =====
  const topCenters = centers
    .map((c) => ({ id: c.id, name: c.name, students: c._count.students, staff: c._count.users }))
    .sort((a, b) => b.students - a.students)
    .slice(0, 8);

  return ok({
    months,
    revenueByMonth: months.map((m) => ({ month: m, amount: revenueByMonth[m] })),
    centersGrowth: months.map((m) => ({ month: m, count: centersGrowth[m] })),
    renewalsByMonth: months.map((m) => ({ month: m, count: renewalsByMonth[m] })),
    renewalRevenueByMonth: months.map((m) => ({ month: m, amount: renewalRevenueByMonth[m] })),
    subCounts,
    totals: {
      centers: centers.length,
      activeCenters: centers.filter((c) => c.status === "ACTIVE").length,
      suspendedCenters: centers.filter((c) => c.status === "SUSPENDED").length,
      studentsTotal,
      revenueTotal12m: billings.filter((b) => b.status === "PAID").reduce((a, b) => a + b.amount, 0),
      outstandingCount: outstanding.length,
      outstandingTotal,
    },
    expiringSoon,
    topCenters,
  });
});
