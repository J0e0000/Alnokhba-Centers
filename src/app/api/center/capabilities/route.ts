import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { getCenterCapabilities, invalidateCenterCapabilities, capabilityNumber } from "@/lib/center-capabilities";
import { CAPABILITY_CATALOG, defaultCapabilityConfig, isCapabilityKey } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * GET /api/center/capabilities — قدرات المركز (لأي موظف مسجّل).
 * الواجهات بتتكيف بيها: كل شاشة بتعرض بس الميزات المفعّلة.
 */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const caps = await getCenterCapabilities(user.centerId);
  return ok({
    capabilities: caps,
    catalog: CAPABILITY_CATALOG,
    canManage: user.role === "MANAGER",
  });
});

type PatchBody = {
  capabilities?: Array<{ key?: string; enabled?: boolean; config?: Record<string, unknown> }>;
};

/**
 * PATCH /api/center/capabilities — تفعيل/إيقاف قدرات المركز (المدير فقط).
 * الحساب (Account permissions) منفصل عن قدرات المركز — الفحص النهائي بيخلط الاتنين.
 */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<PatchBody>(req);
  const updates = Array.isArray(body.capabilities) ? body.capabilities : [];
  if (!updates.length) throw new ApiError("مفيش تغييرات — حدّد الميزات اللي هتتعدل.");

  const before = await getCenterCapabilities(user.centerId);
  const after: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {};

  for (const u of updates) {
    const key = String(u.key ?? "");
    if (!isCapabilityKey(key)) throw new ApiError(`ميزة مش معروفة: ${key}.`, 400);
    const current = before[key];
    let enabled = current.enabled;
    let config = { ...defaultCapabilityConfig(key), ...current.config };

    if (u.enabled !== undefined) enabled = !!u.enabled;

    // قواعد الـ config لكل قدرة (حدود أمان صارمة)
    if (u.config && typeof u.config === "object") {
      if (key === "fingerprint") {
        if (u.config.maxUsers !== undefined) {
          config.maxUsers = capabilityNumber(u.config, "maxUsers", 3, 1, 10);
        }
      } else if (key === "staff_qr_checkin") {
        if (u.config.slotSeconds !== undefined) {
          config.slotSeconds = capabilityNumber(u.config, "slotSeconds", 10, 5, 30);
        }
      } else if (key === "teacher_auto_attendance") {
        if (u.config.requireCenterPresence !== undefined) {
          config.requireCenterPresence = !!u.config.requireCenterPresence;
        }
      }
      // مفاتيح تانية: مفيش config مسموح — تجاهل صامت
    }

    await db.centerCapability.upsert({
      where: { centerId_key: { centerId: user.centerId, key } },
      create: { centerId: user.centerId, key, enabled, config: JSON.stringify(config) },
      update: { enabled, config: JSON.stringify(config) },
    });
    after[key] = { enabled, config };
  }

  // الكاش بيتقري في كل نداء حضور — أي تعديل من المدير بيلغيه فورًا (توسعة Task R)
  invalidateCenterCapabilities(user.centerId);

  await logAudit({
    user,
    action: AUDIT.CAPABILITIES_UPDATED,
    entity: "CENTER",
    entityId: user.centerId,
    before: Object.fromEntries(Object.keys(after).map((k) => [k, before[k as keyof typeof before]])),
    after,
    reason: "تحديث ميزات المركز (الحضور والpresence)",
  });

  const caps = await getCenterCapabilities(user.centerId);
  return ok({ capabilities: caps });
});
