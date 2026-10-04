import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { rateLimit } from "@/lib/auth";
import { resolveSessionQr } from "@/lib/session-qr";
import { hasCapability } from "@/lib/center-capabilities";
import { issueSightingPv } from "@/lib/checkin-pv";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance/public/peek?token=&deviceId= — عام (من غير أي تسجيل دخول)
 *
 * صفحة الحضور العامة /a/<token> بتسأل هنا الأول عشان تعرف:
 * - الحصة إيه (اسم للمجموعة/المادة بس — مفيش IDs حساسة ولا بيانات طلاب)
 * - الكود لسه شغال ولا لأ (منتهي/متدوّر/الحصة مقفولة → رسالة ودية)
 * - إثبات sighting موقّع (pv) لو الكود حي دلوقتي — ده اللي بيسمح للطالب
 *   اللي فتح الصفحة والكود حي إنه يكمل يكتب كوده في نافذة السماح
 *   حتى لو كود الشاشة اتجدد في الوقت اللي هو بيكتب (spec §4).
 *
 * السكرين شوت المتبعت لحد بره الحصة: الـ peek بتاعه بيحصل بعد ما الكود مات
 * → مفيش pv → التسجيل هيرفض. كل التحقق النهائي في /check-in على السيرفر.
 */

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 40) || "unknown";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = handler(async (req: Request) => {
  // مقياس قاعة: فصل كامل بيمسح الكود في نفس الدقيقة من نفس الواي فاي (600/دقيقة)
  rateLimit(`peek:${clientIp(req)}`, 600, 60_000);

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim().toLowerCase();
  const deviceId = (url.searchParams.get("deviceId") ?? "").trim();

  let qr;
  try {
    qr = await resolveSessionQr(token); // INVALID | INACTIVE (متدوّر) | EXPIRED
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : "INVALID";
    return ok({ valid: false, reason: code === "EXPIRED" ? "EXPIRED" : code === "INACTIVE" ? "REPLAYED" : "INVALID" });
  }
  if (qr.scope !== "CENTERS" || !qr.centerId) {
    return ok({ valid: false, reason: "INVALID" });
  }

  // قدرة المركز: حضور QR الحصة = dynamic_qr
  if (!(await hasCapability(qr.centerId, "dynamic_qr"))) {
    return ok({ valid: false, reason: "CAPABILITY_OFF" });
  }

  const session = await db.sessionInstance.findUnique({ where: { id: qr.sessionId } });
  if (!session) return ok({ valid: false, reason: "INVALID" });
  if (session.status === "CLOSED") return ok({ valid: false, reason: "CLOSED" });
  if (session.status === "CANCELLED") return ok({ valid: false, reason: "CANCELLED" });

  // إثبات sighting — بيتولّد بس لما الكود حي دلوقتي ومربوط بمعرّف الجهاز
  const pv = UUID_RE.test(deviceId) ? issueSightingPv(qr.qrId, deviceId).pv : null;

  return ok({
    valid: true,
    sessionLabel: qr.sessionLabel,
    status: session.status,
    pv,
    // وضع الحضور (spec §1): OPEN = مطلوب اسم + كود بطول محدد · ROSTER = كود الطالب (والاسم فحص ناعم)
    studentSource: session.studentSource,
    expectedCodeLength: session.studentSource === "OPEN"
      ? Math.max(3, Math.min(12, session.studentCodeLength ?? 5))
      : null,
    // كود القاعة المتغيّر (مضاد مشاركة الـ QR): الصفحة بتظهر خانة كتابته لما الحصة تطلبه
    requireRoomPin: session.requireRoomPin === true,
  });
});
