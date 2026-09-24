import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toPiastres, toEGP, todayStr } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import { sendPushToStudents } from "@/lib/push";
import { notifyManagers, notifyUser } from "@/lib/staff-notify";
import { APPROVAL_TYPES, canRequest, canDirect, type ApprovalType } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// ============================= أنواع مساعدة =============================

type RequestPayload = {
  amountEgp?: number; // بالجنيه كما كتبه الموظف
  sessionId?: string | null;
  groupId?: string | null;
  note?: string | null;
  balanceBefore?: number; // لقطة رصيد وقت الطلب (بالقروش)
  sessionLabel?: string | null;
  groupLabel?: string | null;
};

type CreateBody = {
  type?: string;
  studentId?: string;
  amount?: number | string;
  reason?: string;
  sessionId?: string;
  groupId?: string;
  note?: string;
};

const TYPE_LABEL: Record<string, string> = {
  REFUND: "استرداد فلوس",
  ADJUSTMENT: "تسوية رصيد",
  SESSION_CANCEL: "إلغاء حصة",
  STUDENT_CANCEL: "أرشفة طالب",
  REGISTRATION_CANCEL: "إلغاء تسجيل من مجموعة",
};

// ============================= GET — القوايم =============================

/**
 * GET /api/approvals
 * - المدير: كل طلبات السنتر (PENDING + آخر القرارات) + إحصائيات
 * - الاستقبال: طلباته هو بس (يتابع حالة طلبه)
 */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";

  const isManager = user.role === "MANAGER";
  const where = isManager && scope === "all"
    ? { centerId: user.centerId }
    : { centerId: user.centerId, requestedBy: user.id };

  const [rows, pendingCount] = await Promise.all([
    db.approvalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.approvalRequest.count({ where: { centerId: user.centerId, status: "PENDING" } }),
  ]);

  const studentIds = [...new Set(rows.map((r) => r.studentId).filter(Boolean))] as string[];
  const students = studentIds.length
    ? await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true, code: true } })
    : [];
  const studentMap = new Map(students.map((s) => [s.id, s]));

  return ok({
    isManager,
    pendingCount,
    requests: rows.map((r) => {
      const payload = JSON.parse(r.payload) as RequestPayload;
      const st = r.studentId ? studentMap.get(r.studentId) : undefined;
      return {
        id: r.id, number: r.number, type: r.type, typeLabel: TYPE_LABEL[r.type] ?? r.type,
        status: r.status, student: st ? { id: st.id, name: st.name, code: st.code } : null,
        amount: r.amount, // قروش (الأثر المالي)
        amountEgp: payload.amountEgp,
        reason: r.reason, note: payload.note ?? null,
        sessionId: payload.sessionId ?? null, sessionLabel: payload.sessionLabel ?? null,
        groupId: payload.groupId ?? null, groupLabel: payload.groupLabel ?? null,
        balanceBefore: payload.balanceBefore ?? null,
        requestedBy: r.requestedBy, requestedByName: r.requestedByName,
        decidedByName: r.decidedByName, decidedAt: r.decidedAt,
        decisionNote: r.decisionNote, executedTxnId: r.executedTxnId,
        createdAt: r.createdAt,
      };
    }),
  });
});

// ============================= POST — تقديم طلب =============================

/**
 * POST /api/approvals — موظف استقبال (بدون صلاحية مباشرة) يقدّم طلب موافقة.
 * المدير مالوش طلبات — هو بينفّذ مباشرة. الفحص على السيرفر دايمًا.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<CreateBody>(req);

  const type = String(body.type ?? "") as ApprovalType;
  if (!APPROVAL_TYPES[type]) throw new ApiError("نوع الطلب ده مش معروف.", 400);

  // مينفعش المدير يقدّم طلب — هو بينفّذ مباشرة
  if (canDirect(user, type)) {
    throw new ApiError("عندك صلاحية تنفيذ العملية دي مباشرة — مش محتاج طلب موافقة.", 400);
  }
  // صلاحية الطلب — فحص السيرفر (مش إخفاء زرار)
  if (!canRequest(user, type)) {
    throw new ApiError("ممعك صلاحية تنفيذ ولا طلب العملية دي — راجع مدير السنتر.", 403);
  }

  const reason = String(body.reason ?? "").trim();
  if (reason.length < 3) throw new ApiError("اكتب سبب الطلب بوضوح (3 حروف على الأقل) — المدير محتاجه يقرر.");
  if (reason.length > 300) throw new ApiError("سبب الطلب طويل أوي — اختصره.");

  // الطالب (لو معني بالطلب) لازم يكون من نفس السنتر
  let student: { id: string; name: string; code: string } | null = null;
  if (body.studentId) {
    const s = await db.student.findFirst({
      where: { id: String(body.studentId), centerId: user.centerId },
      select: { id: true, name: true, code: true },
    });
    if (!s) throw new ApiError("الطالب ده مش موجود في السنتر ده.", 404);
    student = s;
  }

  const payload: RequestPayload = { note: body.note?.trim() || null };

  // تحقق مبدئي حسب النوع
  if (type === "REFUND" || type === "ADJUSTMENT") {
    if (!student) throw new ApiError("العملية دي محتاجة طالب — اختار الطالب الأول.");
    let egp: number;
    try { egp = typeof body.amount === "string" ? parseFloat(body.amount) : Number(body.amount); } catch { egp = NaN; }
    if (!isFinite(egp)) throw new ApiError("اكتب المبلغ صح — أرقام بس.");
    if (type === "REFUND" && egp <= 0) throw new ApiError("مبلغ الاسترداد لازم يكون أكبر من صفر.");
    if (type === "ADJUSTMENT" && egp === 0) throw new ApiError("قيمة التسوية صفر — مفيش حاجة تتسوى.");
    if (Math.abs(egp) > 100000) throw new ApiError("المبلغ ده كبير بشكل غير منطقي — راجعه تاني.");
    payload.amountEgp = egp;
    payload.balanceBefore = await studentBalance(student.id);
  }

  if (type === "SESSION_CANCEL") {
    if (!body.sessionId) throw new ApiError("اختار الحصة اللي عايز تلغيها.");
    const sess = await db.sessionInstance.findFirst({
      where: { id: String(body.sessionId), centerId: user.centerId },
      include: { group: { include: { subject: true, grade: true } } },
    });
    if (!sess) throw new ApiError("الحصة دي مش موجودة.", 404);
    if (sess.status !== "OPEN") throw new ApiError("الحصة مش مفتوحة — مينفعش يتقدم عليها طلب إلغاء.");
    payload.sessionId = sess.id;
    payload.sessionLabel = `${sess.group.grade.name} ${sess.group.subject.name} — ${sess.date} ${sess.startTime}`;
    if (!student && body.studentId) payload.note = payload.note;
  }

  if (type === "STUDENT_CANCEL") {
    if (!student) throw new ApiError("اختار الطالب اللي عايز تأرشفة.");
    if (student) {
      const s = await db.student.findFirst({ where: { id: student.id }, select: { status: true } });
      if (s && s.status !== "ACTIVE") throw new ApiError("الطالب ده مش نشاط أصلًا — راجع حالته.");
    }
  }

  if (type === "REGISTRATION_CANCEL") {
    if (!student || !body.groupId) throw new ApiError("إلغاء التسجيل محتاج طالب ومجموعة.");
    const reg = await db.studentGroup.findFirst({
      where: { studentId: student.id, groupId: String(body.groupId), status: "ACTIVE" },
      include: { group: { include: { subject: true, grade: true } } },
    });
    if (!reg) throw new ApiError("التسجيل ده مش موجود أو اتلغى قبل كده.");
    payload.groupId = reg.groupId;
    payload.groupLabel = `${reg.group.grade.name} — ${reg.group.subject.name} (مجموعة ${reg.group.name})`;
  }

  // منع تكرار الطلبات: نفس الموظف + نفس النوع + نفس الطالب + PENDING شغال
  const dupeWhere: Record<string, unknown> = {
    centerId: user.centerId, requestedBy: user.id, type, status: "PENDING",
  };
  if (student) dupeWhere.studentId = student.id;
  else dupeWhere.studentId = null;
  if (type === "SESSION_CANCEL") dupeWhere.payload = { contains: `"sessionId":"${payload.sessionId}"` };
  const dupe = await db.approvalRequest.findFirst({ where: dupeWhere, select: { id: true, number: true } });
  if (dupe) throw new ApiError(`في طلب شغال بنفس البيانات خلاص (${dupe.number}) — استنى قرار المدير الأول.`, 409);

  // الأثر المالي بالقروش (للعرض على المدير)
  const amountPiastres =
    type === "REFUND" ? -toPiastres(payload.amountEgp!) :
    type === "ADJUSTMENT" ? toPiastres(payload.amountEgp!) :
    null;

  const request = await db.$transaction(async (tx) => {
    const last = await tx.approvalRequest.findFirst({
      where: { centerId: user.centerId }, orderBy: { seq: "desc" }, select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    return await tx.approvalRequest.create({
      data: {
        centerId: user.centerId, seq, number: `AR-${String(seq).padStart(6, "0")}`,
        type, studentId: student?.id ?? null,
        payload: JSON.stringify(payload),
        amount: amountPiastres, reason,
        requestedBy: user.id, requestedByName: user.name,
      },
    });
  });

  // إشعار فوري لكل مدراء السنتر
  const amountLabel = payload.amountEgp !== undefined ? ` بمبلغ ${toEGP(toPiastres(Math.abs(payload.amountEgp))).toLocaleString("en-EG")} ج` : "";
  await notifyManagers(user.centerId, {
    type: "APPROVAL_REQUEST",
    title: `طلب ${TYPE_LABEL[type]}${amountLabel}`,
    body: `${user.name} طلب ${TYPE_LABEL[type]}${student ? ` للطالب ${student.name} (كود ${student.code})` : ""}${payload.sessionLabel ? ` — حصة ${payload.sessionLabel}` : ""}${payload.groupLabel ? ` — ${payload.groupLabel}` : ""}. السبب: ${reason}`,
    link: "approvals",
    refId: request.id,
  });

  await logAudit({
    user,
    action: "تقديم طلب موافقة",
    entity: "APPROVAL_REQUEST",
    entityId: request.id,
    after: { number: request.number, type, student: student?.name ?? null, amount: amountPiastres, reason },
  });

  return ok({
    request: { id: request.id, number: request.number, type, typeLabel: TYPE_LABEL[type] },
    message: `تم إرسال الطلب للمدير (${request.number}) — هتوصلك نتيجته فور اتخاذ القرار.`,
  }, { status: 201 });
});

// ============================= PATCH — قرار المدير =============================

type DecideBody = {
  id?: string;
  action?: "approve" | "reject" | "cancel";
  note?: string;
};

/**
 * PATCH /api/approvals — المدير يعتمد/يرفض (والطالب صاحب الطلب يقدر يلغيه).
 * مضاد للسباقات: الانتقال PENDING → APPROVED/REJECTED بيحصل مرة واحدة بس
 * (updateMany شرطي جوه transaction — أي ضغطة تانية بترجع 409).
 */
export const PATCH = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<DecideBody>(req);
  const id = String(body.id ?? "");

  const request = await db.approvalRequest.findFirst({
    where: { id, centerId: user.centerId },
  });
  if (!request) throw new ApiError("الطلب ده مش موجود.", 404);

  const type = request.type as ApprovalType;
  const meta = APPROVAL_TYPES[type];
  if (!meta) throw new ApiError("نوع الطلب ده مش معروف.", 400);

  // ---------- صاحب الطلب يلغي طلبه (PENDING بس) ----------
  if (body.action === "cancel") {
    if (request.requestedBy !== user.id && user.role !== "MANAGER") {
      throw new ApiError("الطلب ده مش بتاعك.", 403);
    }
    const claimed = await db.$transaction(async (tx) => {
      const r = await tx.approvalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "CANCELLED", decidedBy: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: "تم إلغاء الطلب من صاحبه" },
      });
      return r.count === 1;
    });
    if (!claimed) throw new ApiError("الطلب ده اتفصل خلاص — اتعمل فيه قرار.", 409);
    await logAudit({ user, action: "إلغاء طلب موافقة", entity: "APPROVAL_REQUEST", entityId: id, before: { status: "PENDING" }, after: { status: "CANCELLED" } });
    return ok({ ok: true, status: "CANCELLED" });
  }

  // ---------- القرار: للمدير بس (فحص سيرفر — مش إخفاء زرار) ----------
  if (user.role !== "MANAGER") {
    throw new ApiError("قرار الطلب للمدير بس — انت صاحب الطلب بتستنى النتيجة.", 403);
  }

  const note = String(body.note ?? "").trim() || null;
  const payload = JSON.parse(request.payload) as RequestPayload;

  if (body.action === "reject") {
    if (!note || note.length < 3) throw new ApiError("اكتب سبب الرفض (3 حروف على الأقل) — عشان الموظف يفهم.");
    const claimed = await db.$transaction(async (tx) => {
      const r = await tx.approvalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "REJECTED", decidedBy: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: note },
      });
      return r.count === 1;
    });
    if (!claimed) throw new ApiError("الطلب ده اتقرر فيه خلاص — مينفعش يتقرر مرتين.", 409);

    // مفيش أي تغيير مالي — السجلات زي ما هي
    await logAudit({
      user, action: "رفض طلب موافقة", entity: "APPROVAL_REQUEST", entityId: id,
      before: { status: "PENDING", type, amount: request.amount },
      after: { status: "REJECTED", note },
      reason: `رفض ${request.number}: ${note}`,
    });
    await notifyUser(request.requestedBy, user.centerId, {
      type: "APPROVAL_DECIDED",
      title: `اترفض طلبك ${request.number}`,
      body: `المدير ${user.name} رفض طلب ${TYPE_LABEL[type]}${request.amount ? ` (${toEGP(Math.abs(request.amount)).toLocaleString("en-EG")} ج)` : ""}. السبب: ${note}`,
      link: "payments",
      refId: request.id,
    });
    return ok({ ok: true, status: "REJECTED" });
  }

  if (body.action !== "approve") throw new ApiError("قرار غير معروف.", 400);

  // ---------- التنفيذ بعد الاعتماد (transaction واحد + claim شرطي) ----------
  const result = await db.$transaction(async (tx) => {
    // claim: بس اللي يكسب الشرط ده بينفّذ (ضغطتين/مديرين/تابين = مرة واحدة)
    const claim = await tx.approvalRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", decidedBy: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: note },
    });
    if (claim.count !== 1) throw new ApiError("الطلب ده اتقرر فيه خلاص — مينفعش يتقرر مرتين.", 409);

    let executedTxnId: string | null = null;
    let executedNote = note;

    if (type === "REFUND" || type === "ADJUSTMENT") {
      const studentId = request.studentId!;
      const egp = payload.amountEgp!;
      const signed =
        type === "REFUND" ? -toPiastres(egp) : toPiastres(egp); // ADJUSTMENT keeps its sign
      const reasonText = `${TYPE_LABEL[type]} بقرار المدير — ${request.number} — السبب: ${request.reason}${note ? ` · ${note}` : ""}`;
      const txn = await tx.studentTransaction.create({
        data: {
          centerId: user.centerId, studentId, sessionId: null,
          type, amount: signed, method: "CASH",
          reason: reasonText,
          createdBy: user.id,
        },
      });
      executedTxnId = txn.id;
    } else if (type === "SESSION_CANCEL") {
      const sess = await tx.sessionInstance.findFirst({
        where: { id: payload.sessionId ?? "", centerId: user.centerId },
      });
      if (!sess) {
        executedNote = `${executedNote ?? ""} · الحصة مش موجودة (اتشالت)`.trim();
      } else if (sess.status === "CLOSED") {
        executedNote = `${executedNote ?? ""} · الحصة اتقفلت وقت انتظار الموافقة — مينفعش تتلغي`.trim();
      } else if (sess.status === "CANCELLED") {
        executedNote = `${executedNote ?? ""} · الحصة اتلغت قبل كده`.trim();
      } else {
        await tx.sessionInstance.update({ where: { id: sess.id }, data: { status: "CANCELLED" } });
      }
    } else if (type === "STUDENT_CANCEL") {
      const st = await tx.student.findFirst({ where: { id: request.studentId ?? "", centerId: user.centerId } });
      if (!st) {
        executedNote = `${executedNote ?? ""} · الطالب مش موجود`.trim();
      } else if (st.status !== "ACTIVE") {
        executedNote = `${executedNote ?? ""} · الطالب ${st.status === "ARCHIVED" ? "مؤرشف" : "موقوف"} أصلًا`.trim();
      } else {
        await tx.student.update({ where: { id: st.id }, data: { status: "ARCHIVED" } });
      }
    } else if (type === "REGISTRATION_CANCEL") {
      const reg = await tx.studentGroup.findFirst({
        where: { studentId: request.studentId ?? "", groupId: payload.groupId ?? "", status: "ACTIVE" },
      });
      if (!reg) {
        executedNote = `${executedNote ?? ""} · التسجيل مش موجود أو اتلغى قبل كده`.trim();
      } else {
        await tx.studentGroup.update({ where: { id: reg.id }, data: { status: "CANCELLED" } });
      }
    }

    await tx.approvalRequest.update({
      where: { id },
      data: { executedTxnId, decisionNote: executedNote },
    });

    return { executedTxnId, executedNote, requestId: request.id };
  });

  // إشعار الطالب بالعملية المالية المنفذة (best-effort — زي /api/payments بالظبط)
  if ((type === "REFUND" || type === "ADJUSTMENT") && request.studentId && result.executedTxnId) {
    const egp = payload.amountEgp!;
    const signed = type === "REFUND" ? -toPiastres(egp) : toPiastres(egp);
    const amountLabel = toEGP(toPiastres(Math.abs(egp))).toLocaleString("en-EG");
    const notifTitle = type === "REFUND" ? "استرداد فلوس" : "تسوية رصيد";
    const notifBody = type === "REFUND"
      ? `اتعمل لك استرداد بمبلغ ${amountLabel} ج بقرار إدارة السنتر.`
      : signed > 0 ? `اتضاف لرصيدك ${amountLabel} ج (تسوية).` : `اتخصم من رصيدك ${amountLabel} ج (تسوية).`;
    try {
      await db.studentNotification.create({
        data: { centerId: user.centerId, studentId: request.studentId, type, title: notifTitle, body: notifBody },
      });
      void sendPushToStudents(user.centerId, [request.studentId], {
        title: notifTitle, body: notifBody, url: "/portal", tag: `appr-${request.id}`,
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  await logAudit({
    user,
    action: type === "REFUND" ? AUDIT.REFUND_ISSUED : type === "ADJUSTMENT" ? AUDIT.ADJUSTMENT_MADE : "اعتماد طلب موافقة",
    entity: "APPROVAL_REQUEST",
    entityId: request.id,
    before: { status: "PENDING", type, amount: request.amount, requestedBy: request.requestedByName },
    after: { status: "APPROVED", executedTxnId: result.executedTxnId, note: result.executedNote },
    reason: `اعتماد ${request.number} — طلب من ${request.requestedByName}: ${request.reason}`,
  });

  // إشعار صاحب الطلب بالقرار
  const amountLabel2 = request.amount ? ` (${toEGP(Math.abs(request.amount)).toLocaleString("en-EG")} ج)` : "";
  await notifyUser(request.requestedBy, user.centerId, {
    type: "APPROVAL_DECIDED",
    title: `اتقبل طلبك ${request.number}`,
    body: `المدير ${user.name} اعتمد ${TYPE_LABEL[type]}${amountLabel2}${result.executedTxnId ? " — اتنفذت فورًا" : ""}.${result.executedNote ? ` ${result.executedNote}` : ""}`,
    link: "payments",
    refId: request.id,
  });

  return ok({ ok: true, status: "APPROVED", executedTxnId: result.executedTxnId, note: result.executedNote });
});
