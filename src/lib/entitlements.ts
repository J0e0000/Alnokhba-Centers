import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { deriveSubStatus, type SubStatus } from "@/lib/subscription";
import {
  MODULE_CATALOG,
  MODULE_KEYS,
  isModuleKey,
  moduleOverrideKey,
  parseModuleOverrideKey,
  type ModuleKey,
  type ModuleMap,
  type ModuleState,
} from "@/lib/modules";

/* ============================================================
   محرك الاستحقاق (Entitlement Engine) — Master Prompt §5/§7
   ------------------------------------------------------------
   الترتيب الحاكم (fail-safe — الرفض هو الافتراضي لما مش متأكد):
     1) قيود المنصة: مركز مش ACTIVE → كل الأقسام مقفولة (platform)
     2) حالة الاشتراك المحسوبة: EXPIRED/CANCELLED → مقفول ما عدا
        «التقارير» و«الإعدادات» (قراءة تاريخية) (subscription)
     3) خطة الاشتراك: features != null والقسم مش فيها → مقفول (plan)
        — الخطة سقف: override السنتر ميعديش فوق الخطة أبدًا
     4) override المركز (صف CenterCapability بمفتاح module:<key>):
        المدير يقدر يقفل قسم مشمول في الخطة — ميقدرش يفتح قسم مستثنى
     5) الافتراضي: مفتوح (كل الأقسام الموجودة فعلًا — صفر تراجع)
   - كاش 30 ثانية لكل سنتر (نفس نمط قدرات الحضور) وأي تعديل بيلغيه فورًا.
   - الحصة (quota) منفصلة: assertStudentQuotaTx جوه transaction الكتابة.
============================================================ */

const ENT_TTL_MS = 10_000;
// الكاش للـ subscription+plan بس (نادر التغيير). صفوف override الأقسام (module:*)
// بتتقري من الداتابيز في كل تقييم — صغيرة ومفهرسة — عشان تبديل المدير يبقى فوري
// في كل routes السيرفر حتى لو كل route ليه نسخة module graph مستقلة (Next.js bundling).
const entCache = new Map<string, { at: number; sub: SubscriptionState }>();

export type SubscriptionState = {
  hasSubscription: boolean;
  status: string | null; // raw
  effective: SubStatus | "NONE";
  planId: string | null;
  planName: string | null;
  planFeatures: ModuleKey[] | null; // null = كل الأقسام
  maxStudents: number | null; // null = unlimited
  renewalDate: string | null;
  daysLeft: number | null;
  paymentStatus: string | null;
};

export function invalidateEntitlements(centerId?: string): void {
  if (centerId) entCache.delete(centerId);
  else entCache.clear();
}

/**
 * قراءة آمنة لعمود features في الخطة — حماية من انفصام السكيما (schema drift):
 * لو الكود منشر والعمود لسه متضافش في الداتابيز (db push فشل في البيلد)،
 * أي select عادي للعمود بيرمي P2022 وبيقوّع *كل* الراوتس اللي بتقرا الاستحقاق.
 * هنا: بنرجّع null («الخطة الكاملة») + سجل خطأ صريح — حالة الاشتراك والمركز
 * لسه بيتقفلوا عادي، فمفيش أي فجوة أمنية — ده فتح باب التوافق مش باب الأمان.
 * بترجع النص الخام (JSON string) أو null عشان المتنين يستخدموها.
 */
export async function safePlanFeaturesRaw(planId: string | null | undefined): Promise<string | null> {
  if (!planId) return null;
  try {
    const row = await db.subscriptionPlan.findUnique({ where: { id: planId }, select: { features: true } });
    return row?.features ?? null;
  } catch (e) {
    console.error(
      "[entitlements] plan.features read failed (schema drift? db push pending) — treating plan as FULL:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** قائمة مفاتيح الأقسام لخطة (parsed آمن) — null = الخطة الكاملة. للعرض في لوحة الأدمن. */
export async function planFeaturesList(planId: string | null | undefined): Promise<string[] | null> {
  const raw = await safePlanFeaturesRaw(planId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : null;
  } catch {
    return null;
  }
}

function parsePlanFeatures(raw: string | null): ModuleKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter((k): k is ModuleKey => typeof k === "string" && isModuleKey(k));
    // خطة من غير مفاتيح صالحة = إعداد تالف → fail-safe نعتبرها «كل حاجة»؟ لأ —
    // قائمة فاضية صراحةً معناها مفيش أقسام مشمولة، بس ممنوع نحبط مراكز قديمة:
    // features=[] يعني مفيش أقسام. الـ admin UI مش بيسمح بحفظ فاضية من غير تأكيد.
    return keys;
  } catch {
    return null; // JSON تالف → سلوك الخطة الكاملة (توافق عكسي) + الـ UI بيبين تحذير
  }
}

export async function getSubscriptionState(centerId: string): Promise<SubscriptionState> {
  // select صريح من غير features — العمود بيتقري بعيدًا عبر safePlanFeaturesRaw
  // عشان انفصام السكيما ميوقعش كل الراوتس (شوف التعليق هناك).
  const sub = await db.subscription.findUnique({
    where: { centerId },
    select: {
      status: true, renewalDate: true, trialEndsAt: true, graceUntil: true,
      planId: true, paymentStatus: true,
      plan: { select: { name: true, maxStudents: true } },
    },
  });
  if (!sub) {
    return {
      hasSubscription: false, status: null, effective: "NONE",
      planId: null, planName: null, planFeatures: null, maxStudents: null,
      renewalDate: null, daysLeft: null, paymentStatus: null,
    };
  }
  const derived = deriveSubStatus({
    status: sub.status,
    renewalDate: sub.renewalDate,
    trialEndsAt: sub.trialEndsAt,
    graceUntil: sub.graceUntil,
  });
  return {
    hasSubscription: true,
    status: sub.status,
    effective: derived.effective,
    planId: sub.planId,
    planName: sub.plan?.name ?? null,
    planFeatures: parsePlanFeatures(await safePlanFeaturesRaw(sub.planId)),
    maxStudents: sub.plan?.maxStudents ?? null,
    renewalDate: sub.renewalDate,
    daysLeft: derived.daysLeft,
    paymentStatus: sub.paymentStatus,
  };
}

/** الأقسام الفعلية لسنتر — المصدر الوحيد للحقيقة على السيرفر */
export async function getEffectiveModules(centerId: string): Promise<{ modules: ModuleMap; subscription: SubscriptionState }> {
  let hit = entCache.get(centerId);
  if (hit && Date.now() - hit.at >= ENT_TTL_MS) { entCache.delete(centerId); hit = undefined; }
  const subscription = hit ? hit.sub : await getSubscriptionState(centerId);
  if (!hit) entCache.set(centerId, { at: Date.now(), sub: subscription });

  const [center, overrides] = await Promise.all([
    db.center.findUnique({ where: { id: centerId }, select: { status: true } }),
    db.centerCapability.findMany({ where: { centerId, key: { startsWith: "module:" } }, select: { key: true, enabled: true } }),
  ]);

  const overrideRows = new Map<string, { enabled: boolean }>();
  for (const row of overrides) {
    const k = parseModuleOverrideKey(row.key);
    if (k) overrideRows.set(k, { enabled: row.enabled });
  }

  const centerActive = center?.status === "ACTIVE";
  const subOk =
    !subscription.hasSubscription || // مراكز قبل نظام الاشتراك — سلوك قديم كامل
    subscription.effective === "ACTIVE" ||
    subscription.effective === "TRIAL" ||
    subscription.effective === "GRACE";
  // انتهاء الاشتراك: بيانات التاريخ بتفضل مقروءة (تقارير + إعدادات للعرض) —
  // أي قسم كتابة/تشغيل بيتقفل. الاشتراك عمره ما بيحذف بيانات (spec §5).
  const readOnlyOnExpiry: ModuleKey[] = ["reports", "settings"];

  const modules = {} as ModuleMap;
  for (const key of MODULE_KEYS) {
    let state: ModuleState = { enabled: MODULE_CATALOG[key].defaultEnabled };

    if (!centerActive) state = { enabled: false, lockedBy: "platform" };
    else if (!subOk && !readOnlyOnExpiry.includes(key)) state = { enabled: false, lockedBy: "subscription" };
    else if (subscription.planFeatures && !subscription.planFeatures.includes(key)) state = { enabled: false, lockedBy: "plan" };

    // override المركز: بيطفي قسم مشمول بس — مبيفتحش قسم مستثنى من الخطة/المنصة
    const ov = overrideRows.get(key);
    if (ov && state.enabled && !ov.enabled) state = { enabled: false, lockedBy: "center" };

    modules[key] = state;
  }

  return { modules, subscription };
}

/** بوابة إلزامية — 403 برسالة عربية واضحة لما القسم مقفول */
export async function requireModule(centerId: string, key: ModuleKey): Promise<void> {
  const { modules } = await getEffectiveModules(centerId);
  const st = modules[key];
  if (st && !st.enabled) {
    const why: Record<NonNullable<ModuleState["lockedBy"]>, string> = {
      platform: "حالة المركز الحالية مش مفعّلة على المنصة",
      subscription: "اشتراك السنتر منتهي — جدّد الاشتراك لتفعيل القسم تاني",
      plan: "القسم ده مش مشمول في خطة الاشتراك الحالية",
      center: "القسم متقفل من إعدادات المركز",
    };
    throw new ApiError(`${MODULE_CATALOG[key].label}: ${why[st.lockedBy ?? "center"]}.`, 403);
  }
}

/** حصة الطلاب (maxStudents) — تتنادى جوه transaction إنشاء الطالب عشان منع السباق */
export async function assertStudentQuotaTx(
  tx: { student: { count: (args: { where: { centerId: string; status?: string } }) => Promise<number> } },
  centerId: string,
): Promise<void> {
  const subscription = await getSubscriptionState(centerId);
  if (!subscription.hasSubscription || subscription.maxStudents == null) return; // مفيش حد
  const active = await tx.student.count({ where: { centerId, status: "ACTIVE" } });
  if (active >= subscription.maxStudents) {
    throw new ApiError(
      `وصلتوا للحد الأقصى لعدد الطلاب في خطتكم (${subscription.maxStudents} طالب) — ارفعوا الخطة أو أرشفوا طلاب غير نشطين.`,
      403,
    );
  }
}

/** ملخص للتقييم الفوري من غير كاش — للاستخدام في شاشات الإدارة */
export async function explainEntitlements(centerId: string) {
  const { modules, subscription } = await getEffectiveModules(centerId);
  const overrides = await db.centerCapability.findMany({ where: { centerId, key: { startsWith: "module:" } } });
  return {
    subscription,
    modules: MODULE_KEYS.map((key) => ({
      key,
      overrideRow: overrides.find((r) => r.key === moduleOverrideKey(key))?.enabled ?? null,
      ...modules[key],
    })),
  };
}
