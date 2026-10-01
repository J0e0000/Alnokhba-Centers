import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { rateLimit, ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";
import { resolveSessionQr, touchSessionQr } from "@/lib/session-qr";
import { logAudit, AUDIT } from "@/lib/audit";
import { studentBalance, effectivePrice } from "@/lib/finance";
import { cleanRaw } from "@/lib/normalize";

export const dynamic = "force-dynamic";

type ClaimBody = { token?: string };

/**
 * POST /api/attendance/session-qr/claim — الطالب يسجّل حضوره بنفسه من موباه
 * بمسح كود QR الحصة المتنقل (spec §9-12).
 *
 * الهوية (spec §10 — مفيش تسجيل دخول متكرر + مفيش حضور مجهول):
 * - جلسة بورتال موجودة على الجهاز (جهاز موثوق — بتتعمل مرة واحدة) → حضور فوري SCAN→VERIFY→SUCCESS
 * - مفيش جلسة → NEED_ACTIVATE: الصفحة بتعمل تحقق لمرة واحدة (كود + موبايل) عن طريق
 *   نفس دخول البورتال، وبعدها الجهاز بقى موثوق والمحاولة بيكمل لوحدها.
 * الكود (5 أرقام) لوحده **مش** كفاية تاني — بلاش حضور بكود مسروق.
 *
 * التحقق: توكن نشط وغير منتهي (replay بيتسجل) + حصة مفتوحة بتاريخ النهاردة
 * + الطالب مسجل في المجموعة + مش مؤرشف + مفيش حضور مكرر (unique sessionId+studentId).
 */

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 40) || "unknown";
}

export const POST = handler(async (req: Request) => {
  const body = await readJson<ClaimBody>(req);
  const rawToken = String(body.token ?? "").trim();

  // حدود محاولات معقولة لكل توكن+IP (نحّاس مبسّط على مستوى النسخة)
  rateLimit(`qr-claim:${rawToken.slice(-10)}:${clientIp(req)}`, 20, 60_000);

  let qr;
  try {
    qr = await resolveSessionQr(rawToken); // ApiError لو مش صالح/منتهي/متدوّر
  } catch (e) {
    if (e instanceof ApiError) {
      const code = (e as ApiError & { code?: string }).code;
      await logAudit({
        user: { id: "QR_UNKNOWN", name: "محاولة QR غير ناجحة", centerId: null },
        action: code === "EXPIRED" ? AUDIT.QR_SCAN_EXPIRED : AUDIT.QR_SCAN_REPLAY,
        entity: "SESSION_QR",
        entityId: rawToken.slice(-8),
        reason: `${code ?? "INVALID"} — ${e.message}`,
        after: { ip: clientIp(req) },
      }).catch(() => {});
    }
    throw e;
  }
  if (qr.scope !== "CENTERS" || !qr.centerId) {
    throw new ApiError("الكود ده مش كود حضور سنترز.", 400);
  }

  const portalStudent = await getPortalStudent().catch(() => null);
  if (!portalStudent || portalStudent.centerId !== qr.centerId) {
    // مفيش جهاز موثوق — الصفحة هتعمل تحقق لمرة واحدة (كود + موبايل) وبعدها ترجع هنا
    return ok({
      ok: false,
      reason: "NEED_ACTIVATE",
      message: "فعّل جهازك مرة واحدة بكودك ورقم موبايلك — بعد كده حضورك هيبقى بضغطة واحدة.",
    });
  }
  const student = { id: portalStudent.id, name: portalStudent.name, code: portalStudent.code, status: "ACTIVE" as const };

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

  // لازم يكون مسجّل في المجموعة — مفيش حضور لطالب من بره المجموعة
  const reg = await db.studentGroup.findFirst({
    where: { groupId: session.groupId, studentId: student.id, status: "ACTIVE" },
  });
  if (!reg) {
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.UNAUTHORIZED_ATTENDANCE,
      entity: "SESSION_QR", entityId: session.id,
      reason: `طالب مش مسجل في مجموعة الحصة (${session.group.subject.name})`,
      after: { studentCode: student.code },
    }).catch(() => {});
    return ok({
      ok: false, reason: "NOT_REGISTERED",
      message: "انت مش مسجل في مجموعة الحصة دي — كلّم الاستقبال يسجلّك الأول.",
    });
  }

  // ============================= التسجيل (نفس منطق mark بالظبط) =============================
  // بدون interactive transaction — بتكسر مع PgBouncer transaction-mode (serverless pooler).
  // منع التكرار بيتحقق من unique(sessionId, studentId): اللي ينجح يعمل create هو اللي بيشحن.
  const price = effectivePrice(reg.priceOverride, null, session.price);
  const charge = price; // PRESENT

  let result: { alreadyAttended: boolean; attendance: { id: string; status: string; charged: number | null }; charged: number };
  try {
    const recordedBy = (await db.sessionQRToken.findUnique({ where: { id: qr.qrId }, select: { createdById: true } }))?.createdById ?? null;
    const attendance = await db.attendance.create({
      data: {
        centerId: qr.centerId!, sessionId: session.id, studentId: student.id,
        status: "PRESENT", charged: charge, recordedBy,
        method: "SESSION_QR",
        note: "تسجيل ذاتي — QR الحصة المتنقل (جهاز موثوق)",
      },
    });
    if (charge > 0) {
      await db.studentTransaction.create({
        data: {
          centerId: qr.centerId!, studentId: student.id, sessionId: session.id,
          type: "CHARGE", amount: -charge,
          reason: `حصة ${session.group.subject.name} (QR الحصة)`,
          createdBy: "SESSION_QR",
        },
      }).catch((e) => { console.error("[qr-charge-failed]", e); }); // الحضور نفسه اثبت — الخصم يتراجع يدويًا لو فشل
    }
    result = { alreadyAttended: false, attendance, charged: charge };
  } catch (e) {
    if (/unique constraint|P2002/i.test(e instanceof Error ? e.message : String(e))) {
      const existing = await db.attendance.findUnique({
        where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      });
      if (!existing) throw e;
      result = { alreadyAttended: true, attendance: existing, charged: existing.charged ?? 0 };
    } else {
      throw e;
    }
  }

  if (result.alreadyAttended) {
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.DUPLICATE_ATTENDANCE,
      entity: "SESSION_QR", entityId: session.id,
      reason: "حضور متسجل من قبل — رفض الطلب المكرر",
      after: { studentCode: student.code },
    }).catch(() => {});
  } else {
    await touchSessionQr(qr.qrId);
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.QR_SCAN_SUCCESS,
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
