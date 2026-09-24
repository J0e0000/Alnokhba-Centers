import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toEGP, cleanRaw } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import { waUrl, buildLowBalanceMessage } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * WhatsApp parent notifications — OPT-IN, manual wa.me handoff.
 * No WhatsApp provider credentials are configured in this deployment, so the
 * honest flow is: prepare a localized message → persist the attempt → the staff
 * member opens the WhatsApp chat (wa.me) and sends it themselves. We never
 * claim automatic delivery. Attempts are deduped per (txnId, template) unless
 * the user explicitly retries.
 */

type NotifyBody = {
  studentId?: string;
  txnId?: string;
  template?: "payment_confirm" | "low_balance";
  retry?: boolean;
};

const METHOD_AR: Record<string, string> = { CASH: "كاش", VODAFONE: "محفظة فودافون", INSTAPAY: "انستاباي" };

/** POST /api/notify — prepare a notification attempt, returns message + wa.me URL */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<NotifyBody>(req);

  const student = await db.student.findFirst({ where: { id: String(body.studentId ?? ""), centerId: user.centerId } });
  if (!student) throw new ApiError("الطالب ده مش موجود.", 404);

  const recipient = cleanRaw(student.parentPhone ?? "");
  if (!recipient) throw new ApiError("مفيش رقم واتساب لولي أمر الطالب ده — ضيفه من ملف الطالب.");

  const center = user.center!;
  const template = body.template === "low_balance" ? "low_balance" : "payment_confirm";

  // ---- guards: center-level opt-in ----
  if (template === "payment_confirm" && !center.waPaymentsEnabled) {
    throw new ApiError("تنبيهات الدفع مقفولة — شغّلها الأول من الإعدادات ← تنبيهات الواتساب.", 403);
  }
  if (template === "low_balance" && !center.waLowBalanceEnabled) {
    throw new ApiError("تنبيهات الرصيد مقفولة — شغّلها الأول من الإعدادات ← تنبيهات الواتساب.", 403);
  }

  // ---- build message ----
  let message: string;
  let txnId: string | null = null;

  if (template === "payment_confirm") {
    if (!body.txnId) throw new ApiError("العملية مفقودة — حدد الدفعة الأول.");
    const txn = await db.studentTransaction.findFirst({
      where: { id: String(body.txnId), centerId: user.centerId, type: "PAYMENT" },
    });
    if (!txn) throw new ApiError("الدفعة دي مش موجودة.", 404);
    txnId = txn.id;

    // prefer the center's own template if it exists
    const t = await db.whatsAppTemplate.findUnique({
      where: { centerId_name: { centerId: center.id, name: "تأكيد دفعة" } },
    });
    const balance = await studentBalance(student.id);
    const vars: Record<string, string> = {
      "{student_name}": student.name,
      "{parent_name}": student.parentName ?? "ولي الأمر",
      "{amount}": toEGP(txn.amount).toLocaleString("en-EG"),
      "{method}": METHOD_AR[txn.method ?? "CASH"] ?? "كاش",
      "{balance}": toEGP(Math.abs(balance)).toLocaleString("en-EG"),
      "{balance_state}": balance < 0 ? "المتبقي" : "رصيد",
      "{center_name}": center.name,
      "{center_phone}": center.phone ?? "",
      "{student_code}": student.code,
      "{date}": new Date().toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" }),
    };
    const raw = t?.body ?? "وصلنا مبلغ {amount} جنيه من {student_name} ({method}). {balance_state} الحالي: {balance} جنيه. شكراً لثقتكم.";
    message = raw;
    for (const [k, v] of Object.entries(vars)) message = message.split(k).join(v);
  } else {
    const balance = await studentBalance(student.id);
    const due = Math.max(-balance, 0);
    if (due <= 0) throw new ApiError("الطالب ده رصيده سليم — مفيش مطالبات.");
    message = await buildLowBalanceMessage(center, student);
  }

  // (توقيع السنتر مضمّن جوه buildLowBalanceMessage — نضيفه هنا لرسائل الدفع بس)
  if (template === "payment_confirm" && center.signature) message += `\n— ${center.signature}`;

  // ---- dedupe: one attempt per (txnId, template) ----
  if (txnId) {
    const existing = await db.notificationAttempt.findUnique({
      where: { txnId_template: { txnId, template } },
    });
    if (existing && existing.status === "SENT" && !body.retry) {
      throw new ApiError("الرسالة دي اتبعتت لولي الأمر قبل كده — لو عايز تبعتها تاني اختار «إعادة الإرسال».", 409);
    }
    if (existing && body.retry) {
      await db.notificationAttempt.update({
        where: { id: existing.id },
        data: { status: "PENDING", error: null, bodySnapshot: message, createdBy: user.id, updatedAt: new Date() },
      });
      await logAudit({ user, action: AUDIT.NOTIFICATION_PREPARED, entity: "NOTIFICATION", entityId: existing.id, after: { template, student: student.name, retry: true } });
      return ok({ attemptId: existing.id, phone: recipient, message, waUrl: waUrl(recipient, message), retry: true });
    }
  }

  const attempt = await db.notificationAttempt.create({
    data: {
      centerId: user.centerId, studentId: student.id, txnId,
      template, channel: "WA_HANDOFF", recipient, status: "PENDING",
      bodySnapshot: message, createdBy: user.id,
    },
  }).catch(() => {
    throw new ApiError("في محاولة إرسال مفتوحة لنفس الرسالة — كمّلها أو جرب تاني.", 409);
  });

  await logAudit({ user, action: AUDIT.NOTIFICATION_PREPARED, entity: "NOTIFICATION", entityId: attempt.id, after: { template, student: student.name } });
  return ok({ attemptId: attempt.id, phone: recipient, message, waUrl: waUrl(recipient, message) });
});

/** PATCH /api/notify — record the handoff outcome
 *  OPENED = اتفتحت محادثة واتساب (أقصى ما نقدر نؤكده في التسليم اليدوي)
 *  SENT = تأكيد صريح من الموظف إنه بعت فعلاً
 *  FAILED = فشل فتح المحادثة */
export const PATCH = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<{ attemptId?: string; status?: string; error?: string }>(req);
  const id = String(body.attemptId ?? "");
  const status = body.status === "FAILED" ? "FAILED" : body.status === "SENT" ? "SENT" : "OPENED";

  const attempt = await db.notificationAttempt.findFirst({ where: { id, centerId: user.centerId } });
  if (!attempt) throw new ApiError("محاولة الإرسال دي مش موجودة.", 404);

  await db.notificationAttempt.update({
    where: { id },
    data: { status, error: status === "FAILED" ? (body.error?.slice(0, 200) ?? "فشل فتح المحادثة") : null, updatedAt: new Date() },
  });

  await logAudit({
    user,
    action: status === "FAILED" ? AUDIT.NOTIFICATION_FAILED : AUDIT.NOTIFICATION_SENT,
    entity: "NOTIFICATION", entityId: id,
    after: { template: attempt.template, status, channel: "WA_HANDOFF" },
  });
  return ok({ ok: true, status });
});

/** GET /api/notify?studentId= — recent attempts for a student (history) */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const studentId = new URL(req.url).searchParams.get("studentId") ?? "";
  const attempts = await db.notificationAttempt.findMany({
    where: { centerId: user.centerId, studentId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return ok({
    attempts: attempts.map((a) => ({
      id: a.id, template: a.template, status: a.status, recipient: a.recipient,
      createdAt: a.createdAt, error: a.error,
    })),
  });
});
