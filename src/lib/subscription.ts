import "server-only";
import { db } from "@/lib/db";

/* ============================================================
   دورة حياة الاشتراك (spec §7):
   TRIAL → ACTIVE → (RENEWAL_DUE محسوبة) → GRACE → EXPIRED | CANCELLED
   ⚠️ انتهاء الاشتراك عمره ما بيحذف بيانات السنتر — الحالة بيانات فقط،
   والقرار النهائي (تعليق/أرشفة/حذف) قرار يدوي للأدمن بتسجيل تدقيق.
   كل انتقال بيتسجل في SubscriptionEvent (سجل حياة كامل).
============================================================ */

export const SUB_STATUSES = ["TRIAL", "ACTIVE", "GRACE", "EXPIRED", "CANCELLED"] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

export const SUB_STATUS_LABEL: Record<string, string> = {
  TRIAL: "تجريبي",
  ACTIVE: "نشط",
  GRACE: "فترة سماح",
  EXPIRED: "منتهي",
  CANCELLED: "ملغي",
};

export const SUB_EVENT_LABEL: Record<string, string> = {
  CREATED: "إنشاء الاشتراك",
  TRIAL_START: "بدء تجربة",
  RENEWED: "تجديد",
  STATUS_CHANGE: "تغيير حالة",
  GRACE_APPLIED: "منح فترة سماح",
  PAYMENT: "تسجيل دفعة",
  CANCELLED: "إلغاء",
  REACTIVATED: "إعادة تنشيط",
  PLAN_CHANGE: "تغيير خطة",
};

/** أيام فترة السماح بعد التجاوز (بيتعدل من الإجراء) */
export const GRACE_DAYS_DEFAULT = 7;
/** تحذير قبل الانتهاء بهالكم يوم */
export const EXPIRY_WARNING_DAYS = 14;

/** الحالة الفعلية المحسوبة: بتحترم تواريخ التجربة/السماح حتى لو الصف محتاج تحديث */
export function deriveSubStatus(sub: {
  status: string;
  renewalDate: string;
  trialEndsAt: Date | null;
  graceUntil: Date | null;
}): { effective: SubStatus; renewalDue: boolean; expiringSoon: boolean; daysLeft: number } {
  const today = new Date();
  const renewal = new Date(sub.renewalDate + "T23:59:59");
  const daysLeft = Math.ceil((renewal.getTime() - today.getTime()) / 86400000);

  if (sub.status === "CANCELLED") return { effective: "CANCELLED", renewalDue: false, expiringSoon: false, daysLeft };
  if (sub.status === "TRIAL") {
    if (sub.trialEndsAt && sub.trialEndsAt < today) {
      return { effective: "EXPIRED", renewalDue: true, expiringSoon: false, daysLeft };
    }
    return { effective: "TRIAL", renewalDue: false, expiringSoon: daysLeft <= EXPIRY_WARNING_DAYS, daysLeft };
  }
  if (sub.status === "GRACE") {
    if (sub.graceUntil && sub.graceUntil < today) {
      return { effective: "EXPIRED", renewalDue: true, expiringSoon: false, daysLeft };
    }
    return { effective: "GRACE", renewalDue: true, expiringSoon: true, daysLeft };
  }
  if (sub.status === "EXPIRED") return { effective: "EXPIRED", renewalDue: true, expiringSoon: false, daysLeft };
  // ACTIVE
  if (daysLeft < 0) return { effective: "EXPIRED", renewalDue: true, expiringSoon: false, daysLeft };
  return {
    effective: "ACTIVE",
    renewalDue: daysLeft <= EXPIRY_WARNING_DAYS,
    expiringSoon: daysLeft <= EXPIRY_WARNING_DAYS,
    daysLeft,
  };
}

/** تسجيل حدث في سجل حياة الاشتراك — بيتسكل من كل الإجراءات */
export async function recordSubEvent(opts: {
  subscriptionId: string;
  centerId: string;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  amount?: number | null;
  note?: string | null;
  userId?: string | null;
  userName?: string | null;
}): Promise<void> {
  await db.subscriptionEvent.create({
    data: {
      subscriptionId: opts.subscriptionId,
      centerId: opts.centerId,
      type: opts.type,
      fromStatus: opts.fromStatus ?? null,
      toStatus: opts.toStatus ?? null,
      amount: opts.amount ?? null,
      note: opts.note ?? null,
      createdById: opts.userId ?? null,
      createdByName: opts.userName ?? null,
    },
  });
}
