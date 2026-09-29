import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { rateLimit, ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";
import { resolveSessionQr, touchSessionQr } from "@/lib/session-qr";
import { logAudit, AUDIT } from "@/lib/audit";
import { studentBalance, effectivePrice } from "@/lib/finance";
import { cleanRaw } from "@/lib/normalize";

export const dynamic = "force-dynamic";

type ClaimBody = { token?: string; code?: string };

/**
 * POST /api/attendance/session-qr/claim — الطالب يسجّل حضوره بنفسه من موبايله
 * بمسح كود QR الحصة المتنقل (الطريقة الثالثة للحضور — spec §3).
 *
 * الهوية: جلسة بورتال الطالب لو موجودة، وإلا كود الطالب (5 أرقام).
 * كل قواعد التحقق الحالية محترمة: توكن نشط + حصة مفتوحة وبتاريخ النهاردة +
 * الطالب مش مؤرشف + مسجّل في المجموعة (مفيش تسجيل ذاتي في مجموعات جديدة).
 * منع التكرار: unique(sessionId, studentId) — نفس قاعدة باقي الطرق.
 * التسجيل بيتحسب بنفس سعر وخصم الحضور العادي (PRESENT = خصم سعر الحصة).
 */
export const POST = handler(async (req: Request) => {
  const body = await readJson<ClaimBody>(req);
  const rawToken = String(body.token ?? "").trim();

  const qr = await resolveSessionQr(rawToken); // ApiError لو مش صالح/منتهي
  if (qr.scope !== "CENTERS" || !qr.centerId) {
    throw new ApiError("الكود ده مش كود حضور سنترز.", 400);
  }

  const portalStudent = await getPortalStudent().catch(() => null);

  // ============================= هوية الطالب =============================
  let student: { id: string; name: string; code: string; status: string } | null = null;
  if (portalStudent && portalStudent.centerId === qr.centerId) {
    student = { id: portalStudent.id, name: portalStudent.name, code: portalStudent.code, status: "ACTIVE" };
  } else {
    const code = cleanRaw(String(body.code ?? ""));
    if (!/^\d{5}$/.test(code)) {
      return ok({ ok: false, reason: "NEED_CODE", message: "اكتب كود الطالب (5 أرقام) لتسجيل حضورك." });
    }
    rateLimit(`qr-claim:${qr.qrId}:${code}`, 8, 60_000);
    const byCode = await db.student.findFirst({
      where: { centerId: qr.centerId, code },
      select: { id: true, name: true, code: true, status: true },
    });
    student = byCode;
  }
  if (!student) {
    return ok({ ok: false, reason: "NOT_FOUND", message: "الكود ده مش موجود في السنتر — راجع الاستقبال." });
  }
  if (student.status === "ARCHIVED") {
    return ok({ ok: false, reason: "ARCHIVED", message: "الحساب مؤرشف — راجع إدارة السنتر." });
  }

  const session = await db.sessionInstance.findFirst({
    where: { id: qr.sessionId, centerId: qr.centerId },
    include: { group: { include: { subject: true } } },
  });
  if (!session) return ok({ ok: false, reason: "NO_SESSION", message: "الحصة دي مش موجودة." });
  if (session.status === "CANCELLED") {
    return ok({ ok: false, reason: "CANCELLED", message: "الحصة دي ملغاة — راجع إعلانات السنتر." });
  }
  if (session.status === "CLOSED") {
    return ok({ ok: false, reason: "CLOSED", message: "الحصة اتقفلت — الحضور بيتسجل قبل القفل بس." });
  }

  // الحصة لازم تكون بتاريخ النهاردة — منع إعادة استخدام الكود خارج الحصة المقصودة
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (session.date !== todayStr) {
    return ok({ ok: false, reason: "NOT_TODAY", message: "الكود ده لحصة تانية مش حصة النهاردة." });
  }

  // لازم يكون مسجّل في المجموعة — مفيش تسجيل ذاتي في مجموعات جديدة
  const reg = await db.studentGroup.findFirst({
    where: { groupId: session.groupId, studentId: student.id, status: "ACTIVE" },
  });
  if (!reg) {
    return ok({
      ok: false, reason: "NOT_REGISTERED",
      message: "انت مش مسجل في مجموعة الحصة دي — كلّم الاستقبال يسجلّك الأول.",
    });
  }

  // ============================= التسجيل (نفس منطق mark بالظبط) =============================
  const price = effectivePrice(reg.priceOverride, null, session.price);
  const charge = price; // PRESENT

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student!.id } },
    });
    if (existing) return { alreadyAttended: true as const, attendance: existing, charged: existing.charged ?? 0 };
    const attendance = await tx.attendance.create({
      data: {
        centerId: qr.centerId!, sessionId: session.id, studentId: student!.id,
        status: "PRESENT", charged: charge, recordedBy: (await db.sessionQRToken.findUnique({ where: { id: qr.qrId }, select: { createdById: true } }))?.createdById ?? null,
        method: "SESSION_QR",
        note: "تسجيل ذاتي — QR الحصة المتنقل",
      },
    });
    if (charge > 0) {
      await tx.studentTransaction.create({
        data: {
          centerId: qr.centerId!, studentId: student!.id, sessionId: session.id,
          type: "CHARGE", amount: -charge,
          reason: `حصة ${session.group.subject.name} (QR الحصة)`,
          createdBy: "SESSION_QR",
        },
      });
    }
    return { alreadyAttended: false as const, attendance, charged: charge };
  });

  if (!result.alreadyAttended) {
    await touchSessionQr(qr.qrId);
    await logAudit({
      user: { id: "SESSION_QR", name: `QR الحصة — ${student.name}`, centerId: qr.centerId },
      action: AUDIT.ATTENDANCE_RECORDED,
      entity: "ATTENDANCE",
      entityId: result.attendance.id,
      after: { student: student.name, session: session.group.subject.name, method: "SESSION_QR", charged: result.charged },
      reason: "تسجيل ذاتي عبر QR الحصة المتنقل",
    });
  }

  const balance = await studentBalance(student.id);
  return ok({
    ok: true,
    alreadyAttended: result.alreadyAttended,
    studentName: student.name,
    sessionLabel: qr.sessionLabel,
    status: result.attendance.status,
    charged: result.charged,
    balance,
    amountDue: Math.max(-balance, 0),
  });
});
