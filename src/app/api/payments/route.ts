import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toPiastres, toEGP, todayStr, cairoDateStr, cairoDayBounds } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import { sendPushToStudents } from "@/lib/push";
import { hasPermission, canRequest } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type PayBody = {
  studentId?: string;
  amount?: number | string;
  method?: string;
  sessionId?: string;
  note?: string;
  type?: "PAYMENT" | "REFUND" | "ADJUSTMENT";
};

/**
 * POST /api/payments — record a payment / refund / adjustment.
 * Transactional ledger write. Auto-computes credit or remaining and returns
 * the exact Egyptian-Arabic message to show.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<PayBody>(req);
  const type = body.type === "REFUND" || body.type === "ADJUSTMENT" ? body.type : "PAYMENT";

  // ===== فحص صلاحية السيرفر (مش إخفاء زرار) =====
  // الدفعة العادية: صلاحية RECORD_PAYMENT (المدير دايمًا + الاستقبال افتراضيًا —
  // موظف الامتحانات TEACHER معندهاش أبدًا). الاسترداد/التسوية: صلاحية مباشرة.
  if (type === "PAYMENT" && !hasPermission(user, "RECORD_PAYMENT")) {
    throw new ApiError("تسجيل الدفعات محتاج صلاحية «تسجيل الدفعات» — كلم مدير السنتر.", 403);
  }
  if (type !== "PAYMENT" && !hasPermission(user, type === "REFUND" ? "REFUND_PAYMENT" : "ADJUST_BALANCE")) {
    const approvalType = type === "REFUND" ? "REFUND" : "ADJUSTMENT";
    const canAsk = user.role === "RECEPTIONIST" && canRequest(user, approvalType);
    throw new ApiError(
      canAsk
        ? "ممعك صلاحية تنفيذ الاسترداد/التسوية مباشرة — قدّم طلب موافقة للمدير من ملف الطالب (زرار «طلب استرداد»)."
        : "العمليات دي (استرداد / تسوية) للمدير بس.",
      403,
    );
  }

  const studentId = String(body.studentId ?? "");
  const student = await db.student.findFirst({ where: { id: studentId, centerId: user.centerId } });
  if (!student) throw new ApiError("الطالب ده مش موجود في السنتر ده.", 404);

  // Validate amount
  let egp: number;
  try {
    egp = typeof body.amount === "string" ? parseFloat(body.amount) : Number(body.amount);
    if (!isFinite(egp)) throw new Error();
  } catch {
    throw new ApiError("اكتب المبلغ صح — أرقام بس.");
  }
  if (type === "ADJUSTMENT") {
    if (egp === 0) throw new ApiError("قيمة التسوية صفر — مفيش حاجة تتسوى.");
  } else if (egp <= 0) {
    throw new ApiError("المبلغ لازم يكون أكبر من صفر.");
  }
  if (Math.abs(egp) > 100000) throw new ApiError("المبلغ ده كبير بشكل غير منطقي — راجعه تاني.");

  const method = ["CASH", "VODAFONE", "INSTAPAY"].includes(body.method ?? "") ? body.method! : "CASH";

  let sessionId: string | null = null;
  if (body.sessionId) {
    const sess = await db.sessionInstance.findFirst({ where: { id: String(body.sessionId), centerId: user.centerId } });
    if (!sess) throw new ApiError("الحصة دي مش موجودة.", 404);
    sessionId = sess.id;
  }

  const signed =
    type === "PAYMENT" ? toPiastres(egp) :
    type === "REFUND" ? -toPiastres(egp) :
    toPiastres(egp); // ADJUSTMENT keeps its sign

  const before = await studentBalance(studentId);

  const txn = await db.$transaction(async (tx) => {
    const created = await tx.studentTransaction.create({
      data: {
        centerId: user.centerId, studentId, sessionId, type,
        amount: signed, method: type === "PAYMENT" ? method : method,
        reason: body.note?.trim() || null, createdBy: user.id,
      },
    });

    // Payment receipt — sequential per center (RC-000001). SQLite is
    // single-writer so max+1 inside the transaction is race-safe.
    let receipt: { id: string; number: string } | null = null;
    if (type === "PAYMENT") {
      const last = await tx.receipt.findFirst({ where: { centerId: user.centerId }, orderBy: { seq: "desc" }, select: { seq: true } });
      const seq = (last?.seq ?? 0) + 1;
      const r = await tx.receipt.create({
        data: {
          centerId: user.centerId, seq,
          number: `RC-${String(seq).padStart(6, "0")}`,
          txnId: created.id, studentId,
          amount: signed, method,
          balanceBefore: before, balanceAfter: before + signed,
          sessionId, issuedBy: user.id, issuedByName: user.name,
          date: todayStr(),
        },
      });
      receipt = { id: r.id, number: r.number };
    }

    return { txn: created, receipt };
  });

  const after = before + signed;

  // ===== إشعار الطالب في البورتال + Push (لو مشترك — بيوصله حتى لو الموقع مقفول) =====
  // best-effort: فشل الإشعار مش بيكسر الدفع أبدًا
  const amountLabel = toEGP(toPiastres(egp)).toLocaleString("en-EG");
  let notifTitle: string;
  let notifBody: string;
  if (type === "REFUND") {
    notifTitle = "استرداد فلوس";
    notifBody = `اتعمل لك استرداد بمبلغ ${amountLabel} ج.`;
  } else if (type === "ADJUSTMENT") {
    notifTitle = "تسوية رصيد";
    notifBody = signed > 0
      ? `اتضاف لرصيدك ${amountLabel} ج.`
      : `اتخصم من رصيدك ${amountLabel} ج.`;
  } else if (after > 0) {
    notifTitle = "دفعة جديدة";
    notifBody = `وصلنا ${amountLabel} ج — رصيدك بقى ${toEGP(after).toLocaleString("en-EG")} ج.`;
  } else if (after < 0) {
    notifTitle = "دفعة جديدة";
    notifBody = `وصلنا ${amountLabel} ج — الباقي عليك ${toEGP(-after).toLocaleString("en-EG")} ج.`;
  } else {
    notifTitle = "دفعة جديدة";
    notifBody = `وصلنا ${amountLabel} ج — سدّدت كل حاجة 💚`;
  }
  try {
    await db.studentNotification.create({
      data: { centerId: user.centerId, studentId, type, title: notifTitle, body: notifBody },
    });
    void sendPushToStudents(user.centerId, [studentId], {
      title: notifTitle, body: notifBody, url: "/portal", tag: `pay-${txn.txn.id}`,
    }).catch(() => {});
  } catch { /* best-effort — الإشعار ممنع يأثر على الدفع */ }

  let message: string;
  if (type === "REFUND") {
    message = `تم عمل استرداد بمبلغ ${toEGP(toPiastres(egp)).toLocaleString("en-EG")} جنيه`;
  } else if (type === "ADJUSTMENT") {
    message = signed > 0 ? "تمت إضافة المبلغ لرصيد الطالب" : "تم خصم المبلغ من رصيد الطالب";
  } else if (after > 0) {
    message = `تم إضافة ${toEGP(after).toLocaleString("en-EG")} جنيه لرصيد الطالب`;
  } else if (after < 0) {
    message = `تم تسجيل الدفع — المطلوب من الطالب: ${toEGP(-after).toLocaleString("en-EG")} جنيه`;
  } else {
    message = "تم تسجيل الدفع — الطالب سدّد كل حاجة ✅".replace(" ✅", "");
  }

  await logAudit({
    user,
    action: type === "REFUND" ? AUDIT.REFUND_ISSUED : type === "ADJUSTMENT" ? AUDIT.ADJUSTMENT_MADE : AUDIT.PAYMENT_RECORDED,
    entity: "STUDENT_TRANSACTION",
    entityId: txn.txn.id,
    after: { student: student.name, type, amount: signed, method, receipt: txn.receipt?.number ?? null },
  });

  return ok({
    txn: { id: txn.txn.id, amount: signed, type, method },
    receipt: txn.receipt,
    before,
    after,
    balance: after,
    amountDue: Math.max(-after, 0),
    credit: Math.max(after, 0),
    message,
  });
});

/** GET /api/payments?from=&to=&studentId=&method=&sessionId=&page= — payment history */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const studentId = url.searchParams.get("studentId");
  const method = url.searchParams.get("method");
  // فلتر الحصة — لمراجعة الحصة قبل/بعد القفل (مدفوعات الحصة دي بس)
  const sessionId = url.searchParams.get("sessionId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = 30;

  const where: Record<string, unknown> = { centerId: user.centerId };
  if (studentId) where.studentId = studentId;
  if (method) where.method = method;
  if (sessionId) where.sessionId = sessionId;
  where.type = { in: ["PAYMENT", "REFUND"] };
  if (from || to) {
    // حدود أيام القاهرة بالظبط — المعاملات بعد نص الليل تيجي في يومها الصح
    const start = from ? cairoDayBounds(from).start : new Date(0);
    const end = to ? cairoDayBounds(to).end : new Date(8640000000000000);
    where.createdAt = { gte: start, lte: end };
  }

  const dateFiltered = Boolean(from || to);
  const listArgs = {
    where,
    orderBy: { createdAt: "desc" as const },
    include: {
      student: { select: { id: true, name: true, code: true } },
      receipt: { select: { number: true } },
    },
    // مع فلتر تاريخ: بنجيب نافذة كاملة (محدودة بطبيعتها) عشان الفلترة بالقاهرة
    // تبقى دقيقة والـ pagination يفضل صح. من غير فلتر: SQL paging عادي.
    ...(dateFiltered ? { take: 2000 } : { skip: (page - 1) * pageSize, take: pageSize }),
  };
  const [total, agg, txns] = await Promise.all([
    dateFiltered ? Promise.resolve(0) : db.studentTransaction.count({ where }),
    dateFiltered ? Promise.resolve({ _sum: { amount: 0 } }) : db.studentTransaction.aggregate({ _sum: { amount: true }, where: { ...where, type: "PAYMENT" } }),
    db.studentTransaction.findMany(listArgs),
  ]);

  // فلترة دقيقة بتاريخ القاهرة (المعاملات بعد نص الليل تيجي في يومها الصح)
  const scoped = dateFiltered
    ? txns.filter((t) => {
        const c = cairoDateStr(t.createdAt);
        return (!from || c >= from) && (!to || c <= to);
      })
    : txns;
  const pageRows = dateFiltered ? scoped.slice((page - 1) * pageSize, page * pageSize) : scoped;
  const totalPaidSum = dateFiltered
    ? scoped.filter((t) => t.type === "PAYMENT").reduce((a, t) => a + t.amount, 0)
    : (agg._sum.amount ?? 0);

  // sessionId is a plain scalar — resolve session subjects in a second query
  const sessionIds = [...new Set(pageRows.map((t) => t.sessionId).filter(Boolean))] as string[];
  const sessionMap = new Map<string, string>();
  if (sessionIds.length) {
    const sessions = await db.sessionInstance.findMany({
      where: { id: { in: sessionIds }, centerId: user.centerId },
      include: { group: { include: { subject: { select: { name: true } } } } },
    });
    for (const s of sessions) sessionMap.set(s.id, s.group.subject.name);
  }

  // resolve staff names (who recorded each payment — printed on receipts)
  const userIds = [...new Set(pageRows.map((t) => t.createdBy).filter(Boolean))];
  const userMap = new Map<string, string>();
  if (userIds.length) {
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    for (const u of users) userMap.set(u.id, u.name);
  }

  return ok({
    total: dateFiltered ? scoped.length : total,
    page,
    pageSize,
    totalPaid: totalPaidSum,
    payments: pageRows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      method: t.method,
      note: t.reason,
      createdAt: t.createdAt,
      student: t.student ? { id: t.student.id, name: t.student.name, code: t.student.code } : null,
      subject: (t.sessionId ? sessionMap.get(t.sessionId) : undefined) ?? null,
      by: t.createdBy,
      byName: userMap.get(t.createdBy) ?? "—",
      receiptNumber: t.receipt?.number ?? null,
    })),
  });
});
