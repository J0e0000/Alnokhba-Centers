import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireUser, ApiError } from "@/lib/auth";
import { cairoDayBounds } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/**
 * GET /api/reconciliation — مطابقة مالية (spec المرحلة 3).
 * ------------------------------------------------------------
 * بيكتشف التناقضات بين: الإيصالات ↔ معاملات الطلاب ↔ حضور الحصص ↔ خامات الحصص.
 * للقراءة فقط — مفيش تعديل بيانات. مدير السنتر = سنتره بس؛ أدمن المنصة بأي نطاق يحدده.
 * مفيش أسرار/SQL خام في الرد — أكواد تناقض مفهومة + معرفات للمراجعة.
 */
type Issue = { code: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string; refs: Record<string, string | number | null> };

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  let centerId: string | null = null;
  if (user.role === "MANAGER" && user.centerId) centerId = user.centerId;
  else if (user.role === "ADMIN") centerId = url.searchParams.get("centerId");
  if (!centerId) throw new ApiError("مطابقة المالية لمدير السنتر (أو أدمن المنصة بتحديد ?centerId=).", 403);

  const issues: Issue[] = [];
  const MAX = 5000;

  // 1) إيصالات بدون معاملة أو بمبلغ مختلف — أعلى خطورة
  const receipts = await db.receipt.findMany({
    where: { centerId },
    include: { txn: { select: { id: true, amount: true, type: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX,
  });
  let orphanReceipts = 0, amountMismatch = 0;
  for (const r of receipts) {
    if (!r.txn) {
      orphanReceipts++;
      if (issues.length < 100) issues.push({ code: "RECEIPT_WITHOUT_TXN", severity: "HIGH", detail: `إيصال ${r.number} بدون معاملة مربوطة`, refs: { receiptId: r.id, number: r.number, amount: r.amount } });
      continue;
    }
    if (r.txn.type === "PAYMENT" && r.txn.amount !== r.amount) {
      amountMismatch++;
      if (issues.length < 100) issues.push({ code: "RECEIPT_AMOUNT_MISMATCH", severity: "HIGH", detail: `إيصال ${r.number} مبلغه (${r.amount}) مش مطابق لمعاملته (${r.txn.amount})`, refs: { receiptId: r.id, txnId: r.txn.id } });
    }
  }

  // 2) دفعات بدون إيصال (PAYMENT لازم ليه إيصال)
  const payments = await db.studentTransaction.findMany({
    where: { centerId, type: "PAYMENT" },
    select: { id: true, amount: true, receipt: { select: { id: true } }, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX,
  });
  const missingReceipt = payments.filter((p) => !p.receipt);
  for (const p of missingReceipt.slice(0, 50)) {
    issues.push({ code: "PAYMENT_WITHOUT_RECEIPT", severity: "MEDIUM", detail: "دفعة مسجلة بدون إيصال — راجعها", refs: { txnId: p.id, amount: p.amount } });
  }

  // 3) إجماليات الحصص المقفولة vs مجموع حضورها المحصّل
  const closed = await db.sessionInstance.findMany({
    where: { centerId, status: "CLOSED", totalRevenue: { not: null } },
    select: { id: true, date: true, totalRevenue: true, presentCount: true },
    orderBy: { date: "desc" },
    take: 500,
  });
  const sessIds = closed.map((s) => s.id);
  const charges = sessIds.length
    ? await db.attendance.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessIds }, charged: { not: null } }, _sum: { charged: true }, _count: { _all: true } })
    : [];
  const chargeMap = new Map(charges.map((c) => [c.sessionId, c]));
  let revenueMismatch = 0;
  for (const s of closed) {
    const c = chargeMap.get(s.id);
    const chargedSum = c?._sum.charged ?? 0;
    const chargedCount = c?._count._all ?? 0;
    if ((s.totalRevenue ?? 0) !== chargedSum || (s.presentCount ?? 0) !== chargedCount) {
      revenueMismatch++;
      if (issues.length < 100) issues.push({
        code: "SESSION_REVENUE_MISMATCH",
        severity: "MEDIUM",
        detail: `حصة ${s.date}: الإجمالي المخزّن (${s.totalRevenue ?? 0}) ≠ مجموع المحصّل (${chargedSum})`,
        refs: { sessionId: s.id, storedRevenue: s.totalRevenue ?? 0, chargedSum, presentCount: s.presentCount ?? 0, chargedCount },
      });
    }
  }

  // 4) مفتاح عدم تكرار مستخدم لمعاملتين مختلفتين — مستحيل نظريًا (unique) بس للتأكيد
  const withIdem = await db.studentTransaction.findMany({
    where: { centerId, idemKey: { not: null } },
    select: { idemKey: true },
    take: MAX,
  }).catch(() => [] as { idemKey: string | null }[]);
  const idemCounts = new Map<string, number>();
  for (const w of withIdem) if (w.idemKey) idemCounts.set(w.idemKey, (idemCounts.get(w.idemKey) ?? 0) + 1);
  const dupIdem = [...idemCounts.entries()].filter(([, n]) => n > 1).map(([k]) => ({ idemKey: k }));
  for (const d of dupIdem.slice(0, 20)) {
    issues.push({ code: "DUPLICATE_IDEM_KEY", severity: "HIGH", detail: `مفتاح عدم تكرار متكرر: ${d.idemKey}`, refs: { idemKey: d.idemKey } });
  }

  return ok({
    centerId,
    generatedAt: new Date().toISOString(),
    scanned: { receipts: receipts.length, payments: payments.length, closedSessions: closed.length },
    counts: {
      orphanReceipts, amountMismatch, missingReceipt: missingReceipt.length, revenueMismatch, duplicateIdem: dupIdem.length,
    },
    issues,
    note: "الفحص للقراءة فقط — التناقضات بتتصحح بعكس مرتبط (POST /api/payments/reverse) مش بالمسح.",
  });
});
