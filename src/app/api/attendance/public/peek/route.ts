import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { rateLimit } from "@/lib/auth";
import { resolveSessionQr } from "@/lib/session-qr";
import { hasCapability } from "@/lib/center-capabilities";
import { issueSightingPv } from "@/lib/checkin-pv";
import { peekCacheGet, peekCachePut } from "@/lib/peek-cache";

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

/* ============================================================
   توسعة قاعدة البيانات (Task R): ميكرو-كاش 3 ثواني للقراءات —
   معقلته في src/lib/peek-cache.ts مع إبطال مركزي لما القدرات تتغيّر.
   pv بيتولّد **لكل طلب** (موقّع بـ qrId+deviceId+iat — HMAC بدون تخزين).
   التحقق النهائي والأحكام كلها في /check-in — الكاش هنا تسريع قراءة بس.
============================================================ */

export const GET = handler(async (req: Request) => {
  // مقياس قاعة: فصل كامل بيمسح الكود في نفس الدقيقة من نفس الواي فاي (600/دقيقة)
  rateLimit(`peek:${clientIp(req)}`, 600, 60_000);

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim().toLowerCase();
  const deviceId = (url.searchParams.get("deviceId") ?? "").trim();

  // إصابة الكاش: نفس بيانات القراءة + pv جديد بتوقيت دلوقتي
  const cached = peekCacheGet(token);
  if (cached) {
    const c = cached;
    if (c.valid === true && typeof c.qrId === "string") {
      const pv = UUID_RE.test(deviceId) ? issueSightingPv(c.qrId, deviceId).pv : null;
      const { qrId: _qrId, ...rest } = c; // qrId داخلي — مش بيتسرب في الرد
      return ok({ ...rest, pv });
    }
    return ok(c);
  }

  let qr;
  try {
    qr = await resolveSessionQr(token); // INVALID | INACTIVE (متدوّر) | EXPIRED
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : "INVALID";
    const invalid = { valid: false, reason: code === "EXPIRED" ? "EXPIRED" : code === "INACTIVE" ? "REPLAYED" : "INVALID" };
    peekCachePut(token, invalid);
    return ok(invalid);
  }
  if (qr.scope !== "CENTERS" || !qr.centerId) {
    const invalid = { valid: false, reason: "INVALID" };
    peekCachePut(token, invalid);
    return ok(invalid);
  }

  // قدرة المركز: حضور QR الحصة = dynamic_qr
  if (!(await hasCapability(qr.centerId, "dynamic_qr"))) {
    const off = { valid: false, reason: "CAPABILITY_OFF" };
    peekCachePut(token, off);
    return ok(off);
  }

  const session = await db.sessionInstance.findUnique({ where: { id: qr.sessionId } });
  if (!session) {
    const invalid = { valid: false, reason: "INVALID" };
    peekCachePut(token, invalid);
    return ok(invalid);
  }
  if (session.status === "CLOSED" || session.status === "CANCELLED") {
    const dead = { valid: false, reason: session.status === "CLOSED" ? "CLOSED" : "CANCELLED" };
    peekCachePut(token, dead);
    return ok(dead);
  }

  const payload = {
    valid: true as const,
    sessionLabel: qr.sessionLabel,
    status: session.status,
    // وضع الحضور (spec §1): OPEN = مطلوب اسم + كود بطول محدد · ROSTER = كود الطالب (والاسم فحص ناعم)
    studentSource: session.studentSource,
    expectedCodeLength: session.studentSource === "OPEN"
      ? Math.max(3, Math.min(12, session.studentCodeLength ?? 5))
      : null,
    // كود القاعة المتغيّر (مضاد مشاركة الـ QR): الصفحة بتظهر خانة كتابته لما الحصة تطلبه
    requireRoomPin: session.requireRoomPin === true,
    qrId: qr.qrId, // داخلي — بيتشال من الرد تحت
  };
  peekCachePut(token, payload);
  const { qrId: _qrId, ...rest } = payload;

  // إثبات sighting — بيتولّد بس لما الكود حي دلوقتي ومربوط بمعرّف الجهاز
  const pv = UUID_RE.test(deviceId) ? issueSightingPv(qr.qrId, deviceId).pv : null;
  return ok({ ...rest, pv });
});
