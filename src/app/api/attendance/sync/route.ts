import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { effectivePrice } from "@/lib/finance";
import { cleanRaw } from "@/lib/normalize";
import { notifyStudentsAttendance } from "@/lib/notify";
import { hasCapability } from "@/lib/center-capabilities";
import { recordAttendanceEvent } from "@/lib/attendance-core";

export const dynamic = "force-dynamic";

type SyncBody = { sessionId?: string; query?: string; idemKey?: string };

/**
 * POST /api/attendance/sync — مزامنة حضور اتسجل أوفلاين:
 * يحل الكود الخام (5 أرقام أو QR token) → يسجل حضور PRESENT → خصم.
 * Idempotent بثلاث طبقات: idemKey + (session, student) + unique constraint.
 * لو الطالب مش مسجل في المجموعة → يرجّع خطأ واضح (أوفلاين مبيسجلش orange-flow).
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<SyncBody>(req);

  const idemKey = body.idemKey?.trim() || null;
  if (!idemKey) throw new ApiError("مفتاح المزامنة مفقود.");

  // 1) نفس المفتاح اتبعت قبل كده؟ رجّع النتيجة القديمة من غير تكرار
  const byKey = await db.attendance.findUnique({ where: { idemKey } });
  if (byKey && byKey.centerId === user.centerId) {
    const st = byKey.studentId
      ? await db.student.findUnique({ where: { id: byKey.studentId }, select: { name: true } })
      : null;
    return ok({ studentName: st?.name ?? byKey.studentName ?? "طالب", alreadyAttended: true });
  }

  const q = cleanRaw(String(body.query ?? ""));
  if (!q) throw new ApiError("الكود مفقود.");

  const isToken = q.length >= 16 && /^[0-9a-f]+$/i.test(q);
  const isCode = q.length === 5 && /^\d+$/.test(q);
  if (!isToken && !isCode) throw new ApiError("الكود ده مش شكله كود طالب.");

  // بوابة قدرة المركز: مزامنة أوفلاين = حضور بطريقة QR ثابت/كود (static/name)
  if (isToken && !(await hasCapability(user.centerId, "static_qr"))) {
    throw new ApiError("مسح كروت الطلاب مقفول في المركز ده — كلّم المدير.", 403);
  }
  if (!isToken && !(await hasCapability(user.centerId, "static_qr")) && !(await hasCapability(user.centerId, "name_attendance"))) {
    throw new ApiError("حضور الطلاب بالكود/الاسم مقفول في المركز ده — كلّم المدير.", 403);
  }

  const sessionId = String(body.sessionId ?? "");
  const session = await db.sessionInstance.findFirst({
    where: { id: sessionId, centerId: user.centerId },
    include: { group: { include: { subject: true } } },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.");
  if (session.status === "CLOSED") throw new ApiError("الحصة اتقفلت قبل المزامنة — راجع المدير.");
  if (session.status === "CANCELLED") throw new ApiError("الحصة اتلغت — الحضور ده مش ممكن يتسجل.");

  // حل الكود: exact match بالـ token أو الكود — مفيش fuzzy
  const student = await db.student.findFirst({
    where: isToken ? { centerId: user.centerId, qrToken: q } : { centerId: user.centerId, code: q },
    include: { registrations: { where: { status: "ACTIVE" } } },
  });
  if (!student) throw new ApiError("الطالب مش موجود في النظام.");
  if (student.status === "ARCHIVED") throw new ApiError("الطالب ده مؤرشف.");

  const registration = student.registrations.find((r) => r.groupId === session.groupId);
  if (!registration) {
    // أوفلاين: مينفعش نسجّل مجموعة جديدة من غير مراجعة (الـ orange-flow محتاج قرار بشري)
    throw new ApiError("الطالب مش مسجل في مجموعة الحصة دي — راجعها مع الاستقبال.");
  }

  const price = effectivePrice(registration.priceOverride, null, session.price);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId: student.id } },
    });
    if (existing) return { alreadyAttended: true };

    await tx.attendance.create({
      data: {
        centerId: user.centerId, sessionId, studentId: student.id,
        status: "PRESENT", charged: price, recordedBy: user.id, idemKey,
      },
    });
    if (price > 0) {
      await tx.studentTransaction.create({
        data: {
          centerId: user.centerId, studentId: student.id, sessionId, type: "CHARGE",
          amount: -price, reason: `حصة ${session.group?.subject.name ?? ""} (مزامنة أوفلاين)`, createdBy: user.id,
        },
      });
    }
    return { alreadyAttended: false };
  });

  if (!result.alreadyAttended) {
    await recordAttendanceEvent({
      centerId: user.centerId,
      personType: "STUDENT",
      method: isToken ? "STATIC_QR" : "NAME",
      status: "PRESENT",
      studentId: student.id,
      displayName: student.name,
      role: "STUDENT",
      sessionId,
      metadata: { syncedOffline: true, idemKey },
    });
    await logAudit({
      user,
      action: AUDIT.ATTENDANCE_RECORDED,
      entity: "ATTENDANCE",
      entityId: idemKey,
      after: { student: student.name, session: session.group?.subject.name ?? "", syncedOffline: true },
    });

    // إشعار الطالب — الحضور اتسجل بعد مزامنة الأوفلاين
    void notifyStudentsAttendance(
      user.centerId, [student.id],
      "تم تسجيل حضورك ✅",
      `حصة ${session.group?.subject.name ?? ""} — حضورك اتحسب بنجاح. بالتوفيق!`,
    ).catch(() => {});
  }

  return ok({ studentName: student.name, alreadyAttended: result.alreadyAttended });
});
