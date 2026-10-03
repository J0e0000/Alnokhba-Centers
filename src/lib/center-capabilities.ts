import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_KEYS,
  defaultCapabilityConfig,
  defaultCapabilityMap,
  isCapabilityKey,
  type CapabilityKey,
  type CapabilityMap,
} from "@/lib/capabilities";

/* ============================================================
   خدمة قدرات المركز (Server-side) — المصدر الوحيد للحقيقة
   ------------------------------------------------------------
   - أول قراءة لمركز بتزرع الصفوف الافتراضية (كل الميزات القديمة ON،
     البصمة OFF) → صفر تراجع لأي سلوك موجود.
   - requireCapability() بترمي 403 برسالة عربية واضحة لما القدرة مقفولة.
   - قراءة موحدة بمصفوفة واحدة (findMany واحدة لكل نداء).
============================================================ */

/** يقرأ قدرات المركز ويزرع الافتراضي الناقص (idempotent) */
export async function getCenterCapabilities(centerId: string): Promise<CapabilityMap> {
  const rows = await db.centerCapability.findMany({ where: { centerId } });
  const map = defaultCapabilityMap();
  for (const row of rows) {
    if (!isCapabilityKey(row.key)) continue;
    let config: Record<string, unknown> = {};
    if (row.config) {
      try {
        const parsed = JSON.parse(row.config);
        if (parsed && typeof parsed === "object") config = parsed as Record<string, unknown>;
      } catch { /* config تالف → استخدم الافتراضي */ }
    }
    map[row.key] = { enabled: row.enabled, config: { ...defaultCapabilityConfig(row.key), ...config } };
  }
  // زرع الافتراضي الناقص (مراكز قديمة قبل الميزة) — once
  const missing = CAPABILITY_KEYS.filter((k) => !rows.some((r) => r.key === k));
  if (missing.length) {
    await db.centerCapability.createMany({
      data: missing.map((key) => ({
        centerId,
        key,
        enabled: CAPABILITY_CATALOG[key].defaultEnabled,
        config: JSON.stringify(defaultCapabilityConfig(key)),
      })),
    }).catch(() => {}); // سباق بين نداءين → unique بيفشل ونداء تاني غطّاه
  }
  return map;
}

export async function hasCapability(centerId: string, key: CapabilityKey): Promise<boolean> {
  const caps = await getCenterCapabilities(centerId);
  return caps[key].enabled;
}

/** بوابة إلزامية — تُرمي 403 لو القدرة مقفولة على المركز */
export async function requireCapability(centerId: string, key: CapabilityKey): Promise<CapabilityMap> {
  const caps = await getCenterCapabilities(centerId);
  if (!caps[key].enabled) {
    throw new ApiError(
      `الميزة دي مقفولة في المركز (${CAPABILITY_CATALOG[key].label}) — كلّم مدير المركز لو محتاجها.`,
      403,
    );
  }
  return caps;
}

/** رقم من الـ config بحدود أمان */
export function capabilityNumber(config: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(config[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

/** منطق منطقي من الـ config */
export function capabilityBool(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = config[key];
  if (typeof raw === "boolean") return raw;
  return fallback;
}
