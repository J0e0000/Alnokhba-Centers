import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { studentBalance } from "@/lib/finance";
import { hasPermission } from "@/lib/permissions";
import { toEGP } from "@/lib/normalize";

export const dynamic = "force-dynamic";

type ReverseBody = { txnId?: string; reason?: string };

/**
 * POST /api/payments/reverse — تصحيح مرتبط (reversal) لمعاملة دفع مسجّلة بالغلط.
 * ------------------------------------------------------------
 * القاعدة (spec المرحلة 3): المعاملات المنشورة عمرها ما تتعدل أو تتمسح —
 * التصحيح = معاملة جديدة مرتبطة (refTxnId) بمعاملة عكسية، والأصل بيفضل موجود
 * بالتاريخ الكامل. ممنوع عكس نفس المعاملة مرتين (409).
 * الصلاحية: REFUND_PAYMENT (مدير/استقبال مصرّح) + موديول المالية — نطاق السنتر إجباري.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "finance", user);
  if (!hasPermission(user, "REFUND_PAYMENT")) {
    throw new ApiError("عكس الدفعات محتاج صلاحية «استرداد الدفعات» — كلم مدير السنتر.", 403);
  }
  const body = await readJson<ReverseBody>(req);
  const txnId = String(body.txnId ?? "");
  const reason = String(body.reason ?? "").trim();
  if (!txnId) throw new ApiError("حدد المعاملة المطلوب عكسها.");
  if (reason.length < 3) throw new ApiError("اكتب سبب التصحيح — التدقيق محتاجه (3 أحرف على الأقل).");

  // الأصل لازم يكون في سنتر المستخدم — مفيش أي وصول بين سنترات
  const original = await db.studentTransaction.findFirst({
    where: { id: txnId, centerId: user.centerId },
    include: { student: { select: { id: true, name: true, code: true } }, corrections: { select: { id: true, type: true } } },
  });
  if (!original) throw new ApiError("المعاملة دي مش موجودة في سنترك.", 404);
  if (original.type !== "PAYMENT") {
    throw new ApiError("العكس المرتبط متاح لمعاملات الدفع (PAYMENT) بس — الاسترداد/التسوية بيتسجلوا كعمليات مستقلة من نفس الشاشة.", 400);
  }
  if (original.corrections.some((c) => c.type === "REFUND")) {
    throw new ApiError("المعاملة دي متعكسة قبل كده — ممنوع عكسها تاني (409).", 409);
  }

  const before = await studentBalance(original.studentId);

  const reversal = await db.$transaction(async (tx) => {
    // إعادة فحص جوه الترانزاكشن — ضد سباق عكسين متزامنين
    const dup = await tx.studentTransaction.findFirst({ where: { refTxnId: original.id, type: "REFUND" }, select: { id: true } });
    if (dup) throw new ApiError("المعاملة دي متعكسة قبل كده (409).", 409);
    return tx.studentTransaction.create({
      data: {
        centerId: user.centerId,
        studentId: original.studentId,
        sessionId: original.sessionId,
        type: "REFUND",
        amount: -original.amount, // العكس بالظبط — حساب القرش الصحيح (بياسترات)
        method: original.method,
        reason: `عكس دفعة ${original.id}: ${reason}`,
        refTxnId: original.id,
        createdBy: user.id,
      },
    });
  });

  const after = before + reversal.amount;

  await logAudit({
    user,
    action: AUDIT.REFUND_ISSUED,
    entity: "STUDENT_TRANSACTION",
    entityId: reversal.id,
    before: { txn: original.id, amount: original.amount, type: original.type },
    after: { reversalOf: original.id, amount: reversal.amount, reason, student: original.student.name, balanceAfter: after },
  });

  return ok({
    reversal: { id: reversal.id, amount: reversal.amount, refTxnId: original.id, reason: reversal.reason },
    original: { id: original.id, amount: original.amount, preserved: true },
    before, after, balance: after,
    message: `تم عكس دفعة ${toEGP(original.amount).toLocaleString("en-EG")} ج — الأصل محفوظ في السجل للمراجعة`,
  });
});

/** GET /api/payments/reverse?txnId= — حالة العكس لمعاملة (هل متعكسة؟ مين؟ امتى؟) */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "finance", user);
  const url = new URL(req.url);
  const txnId = url.searchParams.get("txnId") ?? "";
  const original = await db.studentTransaction.findFirst({
    where: { id: txnId, centerId: user.centerId },
    include: { corrections: { select: { id: true, type: true, amount: true, reason: true, createdAt: true } } },
  });
  if (!original) throw new ApiError("المعاملة دي مش موجودة في سنترك.", 404);
  return ok({
    id: original.id,
    type: original.type,
    amount: original.amount,
    reversible: original.type === "PAYMENT" && !original.corrections.some((c) => c.type === "REFUND"),
    corrections: original.corrections,
  });
});
