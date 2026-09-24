import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { cairoDayBounds } from "@/lib/normalize";

/**
 * Student balance from the ledger (never stored).
 * balance > 0 → student has credit (الطالب ليه رصيد)
 * balance < 0 → student owes (الطالب عليه)
 */
export async function studentBalance(studentId: string): Promise<number> {
  const agg = await db.studentTransaction.aggregate({
    _sum: { amount: true },
    where: { studentId },
  });
  return agg._sum.amount ?? 0;
}

export async function manyBalances(studentIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (studentIds.length === 0) return map;
  const grouped = await db.studentTransaction.groupBy({
    by: ["studentId"],
    _sum: { amount: true },
    where: { studentId: { in: studentIds } },
  });
  for (const g of grouped) map.set(g.studentId, g._sum.amount ?? 0);
  return map;
}

/** Effective session price for a student (override → group price → session snapshot) */
export function effectivePrice(
  priceOverride: number | null | undefined,
  groupPrice: number | null | undefined,
  sessionPrice: number | null | undefined
): number {
  return priceOverride ?? groupPrice ?? sessionPrice ?? 0;
}

/** Amount due for one session given current balance */
export function amountDueToday(price: number, balance: number): number {
  // balance >= 0 (credit): pay price - credit (min 0)
  // balance < 0 (owes): pay price + debt
  return Math.max(price - Math.max(balance, 0) + Math.abs(Math.min(balance, 0)), 0);
}

export type SessionEconomics = {
  presentCount: number;
  totalRevenue: number;
  teacherShare: number;
  centerShare: number;
  collected: number;
  outstanding: number;
};

/** Compute the full economics of a session from attendance + payments */
export async function sessionEconomics(sessionId: string): Promise<SessionEconomics> {
  const session = await db.sessionInstance.findUnique({
    where: { id: sessionId },
    include: {
      attendance: { where: { status: { in: ["PRESENT", "LATE"] } } },
      group: { select: { sessionPrice: true, teacherPercent: true } },
    },
  });
  if (!session) throw new Error("الحصة دي مش موجودة.");

  let totalRevenue = 0;
  let presentCount = 0;
  for (const att of session.attendance) {
    presentCount += 1;
    totalRevenue += att.charged ?? 0;
  }
  const pct = session.teacherPercent ?? session.group?.teacherPercent ?? 50;
  const teacherShare = Math.round((totalRevenue * pct) / 100);
  const centerShare = totalRevenue - teacherShare;

  const payAgg = await db.studentTransaction.aggregate({
    _sum: { amount: true },
    where: { sessionId, type: "PAYMENT" },
  });
  const collected = payAgg._sum.amount ?? 0;

  return {
    presentCount,
    totalRevenue,
    teacherShare,
    centerShare,
    collected,
    outstanding: totalRevenue - collected,
  };
}

/** Expected cash in drawer for a center+date: opening + cash in − cash out */
export async function expectedCash(centerId: string, date: string): Promise<{
  opening: number;
  cashIn: number;
  cashOut: number;
  expensesTotal: number;
  teacherPayouts: number;
  refunds: number;
  expected: number;
  cashDay: { id: string; status: string; countedCash: number | null; openingCash: number; closedAt: Date | null } | null;
}> {
  const cashDay = await db.cashDay.findUnique({
    where: { centerId_date: { centerId, date } },
  });

  const [payAgg, refundAgg, expAgg, payoutAgg] = await Promise.all([
    db.studentTransaction.aggregate({
      _sum: { amount: true },
      where: { centerId, type: "PAYMENT", method: "CASH", createdAt: { gte: startOf(date), lt: endOf(date) } },
    }),
    db.studentTransaction.aggregate({
      _sum: { amount: true },
      where: { centerId, type: "REFUND", method: "CASH", createdAt: { gte: startOf(date), lt: endOf(date) } },
    }),
    db.expense.aggregate({
      _sum: { amount: true },
      where: { centerId, date },
    }),
    db.teacherSettlement.aggregate({
      _sum: { amount: true },
      where: { centerId, type: "PAID", date },
    }),
  ]);

  const opening = cashDay?.openingCash ?? 0;
  const cashIn = payAgg._sum.amount ?? 0;
  const refunds = Math.abs(refundAgg._sum.amount ?? 0);
  const expensesTotal = expAgg._sum.amount ?? 0;
  const teacherPayouts = Math.abs(payoutAgg._sum.amount ?? 0);
  const cashOut = refunds + expensesTotal + teacherPayouts;

  return {
    opening,
    cashIn,
    cashOut,
    expensesTotal,
    teacherPayouts,
    refunds,
    expected: opening + cashIn - cashOut,
    cashDay: cashDay
      ? {
          id: cashDay.id,
          status: cashDay.status,
          countedCash: cashDay.countedCash,
          openingCash: cashDay.openingCash,
          closedAt: cashDay.closedAt,
        }
      : null,
  };
}

// حدود يوم كامل بتوقيت القاهرة — عشان فلوس نص الليل (00:00–03:00) تحسب في يومها
function startOf(date: string): Date { return cairoDayBounds(date).start; }
function endOf(date: string): Date { return cairoDayBounds(date).end; }

// Prisma type re-export for route convenience
export type Tx = Prisma.TransactionClient;
