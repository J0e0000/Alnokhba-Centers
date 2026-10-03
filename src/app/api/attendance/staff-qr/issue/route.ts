import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { createHash, randomBytes } from "crypto";
import { getCenterCapabilities, capabilityNumber } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/staff-qr/issue — الجهاز (شاشة المركز) يطلب كود الحضور الحالي.
 *
 * المصادقة: deviceKey (48 hex) — مش جلسة مستخدم؛ الجهاز جهاز.
 * - مفتاح الجهاز بيتطابق hash ضد AttendanceDevice (مرتبط بمركزه — tenant ثابت)
 * - قدرة staff_qr_checkin لازم تكون مفعّلة
 * - كود واحد كل مرة (Slot model زي QR الحصة): بيعيش slotSeconds + هامش 4ث
 * - كل نداء بيوقف أكواد الجهاز القديمة (rotation) → الصورة القديمة بتموت
 * - الرابط العام: /c/<token> — التوكن opaque ومفيش IDs حساسة فيه
 */

const STAFF_QR_GRACE_MS = 4_000;

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ deviceKey?: string }>(req);
  const deviceKey = String(body.deviceKey ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{32,96}$/.test(deviceKey)) throw new ApiError("مفتاح الجهاز مش صالح.", 401);

  const keyHash = createHash("sha256").update(deviceKey).digest("hex");
  const device = await db.attendanceDevice.findFirst({ where: { keyHash } });
  if (!device || !device.active) throw new ApiError("الجهاز ده مش مسجل أو متوقف — كلّم مدير المركز.", 401);

  rateLimit(`staff-qr-issue:${device.id}`, 60, 60_000);

  // تحديث آخر ظهور للجهاز (fire-and-forget)
  void db.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});

  const caps = await getCenterCapabilities(device.centerId);
  if (!caps.staff_qr_checkin.enabled) {
    throw new ApiError("حضور الموظفين بـ QR مقفول في المركز ده.", 403);
  }
  const center = await db.center.findUnique({ where: { id: device.centerId }, select: { name: true, status: true } });
  if (!center || center.status !== "ACTIVE") throw new ApiError("المركز مش مفعّل.", 403);

  const slotSeconds = capabilityNumber(caps.staff_qr_checkin.config, "slotSeconds", 10, 5, 30);

  // rotation: أوقف أكواد الجهاز النشطة القديمة
  await db.staffQrToken.updateMany({
    where: { deviceId: device.id, isActive: true },
    data: { isActive: false, expiresAt: new Date() },
  }).catch(() => {});

  const token = randomBytes(20).toString("hex");
  const expiresAt = new Date(Date.now() + slotSeconds * 1000 + STAFF_QR_GRACE_MS);
  await db.staffQrToken.create({
    data: { centerId: device.centerId, deviceId: device.id, token, isActive: true, expiresAt },
  });

  await logAudit({
    user: { id: `device:${device.id}`, name: `جهاز: ${device.name}`, centerId: device.centerId },
    action: AUDIT.STAFF_QR_ISSUED,
    entity: "STAFF_QR",
    entityId: device.id,
    reason: `كود حضور موظفين (سلوت ${slotSeconds}ث)`,
    after: { tokenTail: token.slice(-6), slotSeconds, expiresAt },
  }).catch(() => {});

  return ok({
    token,
    expiresAt: expiresAt.toISOString(),
    slotSeconds,
    centerName: center.name,
    checkinPath: `/c/${token}`,
  });
});
