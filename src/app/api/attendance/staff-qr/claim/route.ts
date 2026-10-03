import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { cairoDateStr } from "@/lib/normalize";
import { requireCapability } from "@/lib/center-capabilities";
import { recordAttendanceEvent } from "@/lib/attendance-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/staff-qr/claim — الموظف يمسح كود شاشة المركز → حضوره يتسجل.
 *
 * التحقق (كلها server-side):
 * - جلسة موظف مطلوبة (requireCenterUser) — مفيش حضور مجهول
 * - قدرة staff_qr_checkin مفعّلة على مركز الموظف
 * - التوكن نشط + غير منتهي (الصورة القديمة بتموت خلال ثواني — replay مرفوض)
 * - توكن المركز التاني مرفوض (center binding — wrong-center fails)
 * - تكرار نفس اليوم → alreadyCheckedIn (مفيش تسجيل مزدوج)
 * - الحدث بيتسجل في السجل الموحد (AttendanceEvent method DYNAMIC_QR personType STAFF)
 */

type ClaimBody = { token?: string };

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 40) || "unknown";
}

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<ClaimBody>(req);
  const token = String(body.token ?? "").trim().toLowerCase();

  if (!/^[0-9a-f]{16,64}$/.test(token)) {
    throw new ApiError("الكود ده مش كود حضور موظفين.", 400);
  }
  rateLimit(`staff-claim:${user.id}:${token.slice(-8)}`, 20, 60_000);

  // قدرة المركز الأول (قبل أي حاجة تانية)
  await requireCapability(user.centerId, "staff_qr_checkin");

  const qr = await db.staffQrToken.findUnique({ where: { token } });
  if (!qr || !qr.isActive) {
    await logAudit({
      user,
      action: AUDIT.QR_SCAN_REPLAY,
      entity: "STAFF_QR",
      entityId: token.slice(-8),
      reason: "كود قديم/متدوّر (replay)",
      after: { ip: clientIp(req) },
    }).catch(() => {});
    throw new ApiError("الكود ده مش شغال — الشاشة بتغير الكود أوتوماتيك، امسح الكود الجديد.", 410);
  }
  if (qr.expiresAt.getTime() < Date.now()) {
    await logAudit({
      user,
      action: AUDIT.QR_SCAN_EXPIRED,
      entity: "STAFF_QR",
      entityId: token.slice(-8),
      reason: "كود منتهي الصلاحية",
      after: { ip: clientIp(req) },
    }).catch(() => {});
    throw new ApiError("الكود انتهت صلاحيته — امسح الكود الجديد من الشاشة.", 410);
  }
  // ربط المركز: كود مركز تاني مرفوض نهائيًا
  if (qr.centerId !== user.centerId) {
    await logAudit({
      user,
      action: AUDIT.UNAUTHORIZED_ATTENDANCE,
      entity: "STAFF_QR",
      entityId: token.slice(-8),
      reason: "كود من مركز تاني",
      after: { ip: clientIp(req), tokenCenter: qr.centerId },
    }).catch(() => {});
    throw new ApiError("الكود ده بتاع مركز تاني — مينفعش يتستخدم هنا.", 403);
  }

  // منع التكرار: نفس الموظف مرة واحدة في يوم القاهرة
  const since = new Date(Date.now() - 36 * 3600 * 1000);
  const prev = await db.attendanceEvent.findFirst({
    where: {
      centerId: user.centerId,
      personType: "STAFF",
      userId: user.id,
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true, method: true },
  });
  if (prev && cairoDateStr(prev.occurredAt) === cairoDateStr(new Date())) {
    return ok({
      ok: true,
      alreadyCheckedIn: true,
      checkinAt: prev.occurredAt.toISOString(),
      message: "حضورك متسجل بالفعل النهاردة 👍",
    });
  }

  await db.staffQrToken.update({
    where: { id: qr.id },
    data: { useCount: { increment: 1 } },
  }).catch(() => {});

  const event = await recordAttendanceEvent({
    centerId: user.centerId,
    personType: "STAFF",
    method: "DYNAMIC_QR",
    status: "CHECK_IN",
    userId: user.id,
    displayName: user.name,
    role: user.role,
    deviceId: qr.deviceId,
    metadata: { via: "staff_qr_screen", tokenTail: token.slice(-6) },
  }, { critical: true });

  await logAudit({
    user,
    action: AUDIT.STAFF_CHECKIN,
    entity: "ATTENDANCE_EVENT",
    entityId: event ?? undefined,
    after: { method: "DYNAMIC_QR", device: qr.deviceId ?? null },
    reason: "حضور موظف بمسح كود شاشة المركز",
  });

  return ok({
    ok: true,
    alreadyCheckedIn: false,
    checkinAt: new Date().toISOString(),
    displayName: user.name,
    message: "تم تسجيل حضورك ✅",
  });
});
