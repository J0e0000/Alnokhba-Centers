import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { cairoDateStr } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/**
 * GET /api/receipts?txnId= — full printable receipt payload for ANY
 * student transaction (PAYMENT has a numbered receipt; REFUND /
 * ADJUSTMENT are built straight from the ledger row so every money
 * movement is printable). Center-scoped, staff-readable.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const txnId = url.searchParams.get("txnId") ?? "";

  const receipt = await db.receipt.findFirst({
    where: { txnId, centerId: user.centerId },
    include: {
      student: { select: { id: true, name: true, code: true, parentName: true, parentPhone: true, grade: { select: { name: true } } } },
    },
  });

  // ---------- PAYMENT with a numbered receipt (the normal path) ----------
  if (receipt) {
    // session subject (if the payment was allocated to a session)
    let sessionInfo: { subject: string; date: string; time: string; room: string | null } | null = null;
    if (receipt.sessionId) {
      const sess = await db.sessionInstance.findFirst({
        where: { id: receipt.sessionId, centerId: user.centerId },
        include: { group: { include: { subject: { select: { name: true } } } } },
      });
      if (sess) {
        sessionInfo = { subject: sess.group.subject.name, date: sess.date, time: `${sess.startTime} - ${sess.endTime}`, room: sess.room };
      }
    }

    const txn = await db.studentTransaction.findUnique({ where: { id: receipt.txnId } });

    await logAudit({ user, action: AUDIT.RECEIPT_PRINTED, entity: "RECEIPT", entityId: receipt.id, after: { number: receipt.number, txnId } });

    return ok({
      receipt: {
        type: "PAYMENT",
        number: receipt.number,
        seq: receipt.seq,
        amount: receipt.amount,
        method: receipt.method,
        balanceBefore: receipt.balanceBefore,
        balanceAfter: receipt.balanceAfter,
        outstanding: Math.max(-receipt.balanceAfter, 0),
        credit: Math.max(receipt.balanceAfter, 0),
        note: txn?.reason ?? null,
        issuedByName: receipt.issuedByName,
        date: receipt.date,
        createdAt: receipt.createdAt,
      },
      student: receipt.student
        ? {
            name: receipt.student.name,
            code: receipt.student.code,
            parentName: receipt.student.parentName,
            parentPhone: receipt.student.parentPhone,
            grade: receipt.student.grade?.name ?? null,
          }
        : null,
      session: sessionInfo,
      center: {
        name: user.center!.name,
        logo: user.center!.logo,
        phone: user.center!.phone,
        address: user.center!.address,
        slogan: user.center!.slogan,
      },
    });
  }

  // ---------- Fallback: REFUND / ADJUSTMENT (no numbered receipt) ----------
  const txn = await db.studentTransaction.findFirst({
    where: { id: txnId, centerId: user.centerId },
    include: {
      student: { select: { id: true, name: true, code: true, parentName: true, parentPhone: true, grade: { select: { name: true } } } },
    },
  });
  if (!txn) throw new ApiError("مفيش إيصال للعملية دي.", 404);

  const issuer = await db.user.findUnique({ where: { id: txn.createdBy }, select: { name: true } });

  let sessionInfo: { subject: string; date: string; time: string; room: string | null } | null = null;
  if (txn.sessionId) {
    const sess = await db.sessionInstance.findFirst({
      where: { id: txn.sessionId, centerId: user.centerId },
      include: { group: { include: { subject: { select: { name: true } } } } },
    });
    if (sess) {
      sessionInfo = { subject: sess.group.subject.name, date: sess.date, time: `${sess.startTime} - ${sess.endTime}`, room: sess.room };
    }
  }

  await logAudit({ user, action: AUDIT.RECEIPT_PRINTED, entity: "STUDENT_TRANSACTION", entityId: txn.id, after: { type: txn.type, txnId } });

  return ok({
    receipt: {
      type: txn.type === "REFUND" ? "REFUND" : "ADJUSTMENT",
      number: null,
      seq: null,
      amount: txn.amount,
      method: txn.method,
      balanceBefore: null,
      balanceAfter: null,
      outstanding: null,
      credit: null,
      note: txn.reason ?? null,
      issuedByName: issuer?.name ?? "—",
      date: cairoDateStr(txn.createdAt),
      createdAt: txn.createdAt,
    },
    student: txn.student
      ? {
          name: txn.student.name,
          code: txn.student.code,
          parentName: txn.student.parentName,
          parentPhone: txn.student.parentPhone,
          grade: txn.student.grade?.name ?? null,
        }
      : null,
    session: sessionInfo,
    center: {
      name: user.center!.name,
      logo: user.center!.logo,
      phone: user.center!.phone,
      address: user.center!.address,
      slogan: user.center!.slogan,
    },
  });
});
