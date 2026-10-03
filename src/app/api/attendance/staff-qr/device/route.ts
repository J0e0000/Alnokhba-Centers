import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager, ApiError, rateLimit } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { createHash, randomBytes } from "crypto";
import { cleanRaw } from "@/lib/normalize";
import { requireCapability } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

/**
 * أجهزة حضور المركز — شاشة QR الثابتة (ولاحقًا أجهزة البصمة).
 * المدير بيعرّف الجهاز → بيستلم deviceKey مرة واحدة (السيرفر بيخزن hash بس).
 * الجهاز بيبقى معرّف بالمركز (tenant) في كل نداءات الإصدار.
 */

/** GET — قائمة الأجهزة (من غير مفاتيح طبعًا) */
export const GET = handler(async () => {
  const user = await requireManager();
  const devices = await db.attendanceDevice.findMany({
    where: { centerId: user.centerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, kind: true, active: true, lastSeenAt: true, createdAt: true,
    },
  });
  return ok({ devices });
});

/** POST — تسجيل جهاز جديد → { deviceId, deviceKey } (المفتاح بيتعرض مرة واحدة) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  // إدارة الأجهزة مربوطة بقدرة حضور الموظفين (شاشة QR) أو البصمة حسب النوع
  const body = await readJson<{ name?: string; kind?: string }>(req);
  const name = cleanRaw(String(body.name ?? "")).slice(0, 60);
  const kind = body.kind === "FINGERPRINT_SCANNER" ? "FINGERPRINT_SCANNER" : "QR_SCREEN";
  if (name.length < 2) throw new ApiError("اكتب اسم واضح للجهاز (حرفين على الأقل).");

  await requireCapability(user.centerId, kind === "FINGERPRINT_SCANNER" ? "fingerprint" : "staff_qr_checkin");
  rateLimit(`device-create:${user.centerId}`, 10, 60_000);

  const deviceKey = randomBytes(24).toString("hex"); // 48 hex — بيتعرض مرة واحدة
  const device = await db.attendanceDevice.create({
    data: {
      centerId: user.centerId,
      name,
      kind,
      keyHash: createHash("sha256").update(deviceKey).digest("hex"),
    },
  });

  await logAudit({
    user,
    action: AUDIT.DEVICE_ADDED,
    entity: "ATTENDANCE_DEVICE",
    entityId: device.id,
    after: { name, kind },
    reason: "تسجيل جهاز حضور جديد",
  });

  return ok({ device: { id: device.id, name: device.name, kind: device.kind }, deviceKey }, { status: 201 });
});

/** PATCH — تفعيل/إيقاف جهاز */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<{ id?: string; active?: boolean }>(req);
  const id = String(body.id ?? "");
  const device = await db.attendanceDevice.findFirst({ where: { id, centerId: user.centerId } });
  if (!device) throw new ApiError("الجهاز ده مش موجود.", 404);
  const active = body.active === undefined ? !device.active : !!body.active;
  await db.attendanceDevice.update({ where: { id: device.id }, data: { active } });
  // إيقاف الجهاز بيميت كل توكناته النشطة فورًا
  if (!active) {
    await db.staffQrToken.updateMany({
      where: { deviceId: device.id, isActive: true },
      data: { isActive: false, expiresAt: new Date() },
    });
  }
  await logAudit({
    user,
    action: AUDIT.DEVICE_REMOVED,
    entity: "ATTENDANCE_DEVICE",
    entityId: device.id,
    before: { active: device.active },
    after: { active },
    reason: active ? "تفعيل جهاز حضور" : "إيقاف جهاز حضور",
  });
  return ok({ ok: true, active });
});
