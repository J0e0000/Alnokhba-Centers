import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { getCenterCapabilities, invalidateCenterCapabilities, capabilityNumber } from "@/lib/center-capabilities";
import { clearPeekCache } from "@/lib/peek-cache";
import { CAPABILITY_CATALOG, defaultCapabilityConfig, isCapabilityKey } from "@/lib/capabilities";
import { getEffectiveModules, invalidateEntitlements } from "@/lib/entitlements";
import { isModuleKey, moduleOverrideKey, MODULE_CATALOG } from "@/lib/modules";

export const dynamic = "force-dynamic";

/**
 * GET /api/center/capabilities — قدرات المركز (لأي موظف مسجّل).
 * الواجهات بتتكيف بيها: كل شاشة بتعرض بس الميزات المفعّلة.
 */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const caps = await getCenterCapabilities(user.centerId);
  const ent = await getEffectiveModules(user.centerId);
  return ok({
    capabilities: caps,
    catalog: CAPABILITY_CATALOG,
    canManage: user.role === "MANAGER",
    // أقسام المنتج الفعلية (استحقاق الخطة/الاشتراك/السنتر) — Master Prompt §8
    modules: ent.modules,
    moduleCatalog: MODULE_CATALOG,
    subscription: ent.subscription,
  });
});

type PatchBody = {
  capabilities?: Array<{ key?: string; enabled?: boolean; config?: Record<string, unknown> }>;
  modules?: Array<{ key?: string; enabled?: boolean }>;
};

/**
 * PATCH /api/center/capabilities — تفعيل/إيقاف قدرات المركز (المدير فقط).
 * الحساب (Account permissions) منفصل عن قدرات المركز — الفحص النهائي بيخلط الاتنين.
 */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<PatchBody>(req);
  const updates = Array.isArray(body.capabilities) ? body.capabilities : [];
  const moduleUpdatesEarly = Array.isArray(body.modules) ? body.modules : [];
  if (!updates.length && !moduleUpdatesEarly.length) throw new ApiError("مفيش تغييرات — حدّد الميزات اللي هتتعدل.");

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
  // كاش الـ peek كمان — عشان تبديل dynamic_qr يبان للطلاب فورًا (من غير نافذة 3ث قديمة)
  clearPeekCache();

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

  // أقسام المنتج (modules) — المدير يقدر يقفل قسم مشمول، أو يرجّع override —
  // ميعرفش يفتح قسم مستثنى من الخطة (السقف عند الخطة — التقييم سيرفري)
  const moduleUpdates = moduleUpdatesEarly;
  const moduleAfter: Record<string, boolean> = {};
  for (const u of moduleUpdates) {
    const key = String(u.key ?? "");
    if (!isModuleKey(key)) throw new ApiError(`قسم مش معروف: ${key}.`, 400);
    const okey = moduleOverrideKey(key);
    if (u.enabled === true) {
      await db.centerCapability.deleteMany({ where: { centerId: user.centerId, key: okey } });
      moduleAfter[key] = true; // رجع لحكم الخطة/الافتراضي
    } else {
      await db.centerCapability.upsert({
        where: { centerId_key: { centerId: user.centerId, key: okey } },
        create: { centerId: user.centerId, key: okey, enabled: false },
        update: { enabled: false },
      });
      moduleAfter[key] = false;
    }
  }
  if (moduleUpdates.length) invalidateEntitlements(user.centerId);

  if (moduleUpdates.length) {
    await logAudit({
      user,
      action: "CENTER_MODULES_UPDATED",
      entity: "CENTER",
      entityId: user.centerId,
      after: moduleAfter,
      reason: "تحديث أقسام المنتج (استحقاقات الخطة)",
    });
  }

  return ok({ capabilities: caps, modules: moduleAfter });
});
