import "server-only";
import type { SessionUser } from "@/lib/auth";
import {
  PERMISSION_CATALOG,
  PERMISSION_IDS,
  RECEPTIONIST_DEFAULT,
  type PermissionId,
} from "@/lib/permission-catalog";

/* ============================================================
   نظام الصلاحيات الدقيقة (Granular Permissions)
   ------------------------------------------------------------
   - المدير بيتحكم في كل صلاحية لكل موظف (من إدارة الموظفين أو لوحة المنصة).
   - التخزين: User.permissions JSON — بس الفروقات عن افتراضي الدور.
   - الفحص بيحصل على السيرفر دايمًا (مفيش إخفاء زرار بيحسب أمان).
   - التمييز: صلاحية مباشرة (Direct) vs صلاحية طلب موافقة (Request).
   - الكتالوج المشترك في permission-catalog.ts (client + server نفس المصدر).
============================================================ */

export type { PermissionId } from "@/lib/permission-catalog";
export { PERMISSION_CATALOG, SENSITIVE_PERMISSIONS } from "@/lib/permission-catalog";

// ============================= افتراضيات الأدوار =============================

/** المدير: كل حاجة مباشرة */
const MANAGER_DEFAULT: PermissionId[] = PERMISSION_IDS;

/** أدمن المنصة: مالوش صلاحيات سنتر — بورتال الأدمن منفصل تمامًا */

export function roleDefaults(role: string): Set<PermissionId> {
  if (role === "MANAGER") return new Set(MANAGER_DEFAULT);
  if (role === "RECEPTIONIST") return new Set(RECEPTIONIST_DEFAULT);
  return new Set<PermissionId>();
}

// ============================= التخزين والقراءة =============================

/** JSON المخزن في User.permissions: { grants: { REFUND_PAYMENT: true, REQUEST_REFUND: false } } */
type PermOverrides = { grants?: Record<string, boolean> };

function parseOverrides(raw: string | null | undefined): PermOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PermOverrides;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** صلاحيات مستخدم محسومة: افتراضي الدور + فروقات المدير (صلاحية بس تتعدي/تتقفل)
 * بيقبل: صف الداتابيز (permissions سترينج JSON) أو SessionUser (permissions قائمة محسومة) */
export function resolvePermissions(
  user: { role: string; permissions?: string | null | string[]; canAddStudents?: boolean },
): Set<PermissionId> {
  // SessionUser جاي محسوم خلاص (قائمة) — استخدمه زي ما هو
  if (Array.isArray(user.permissions)) {
    const sessionSet = new Set(user.permissions as PermissionId[]);
    if (user.role === "MANAGER") return new Set(MANAGER_DEFAULT);
    return sessionSet;
  }
  const set = roleDefaults(user.role);
  if (user.role === "RECEPTIONIST") {
    // التوافق العكسي: canAddStudents القديمة بتتحسب زي ما هي لو مفيش override صريح
    if (user.permissions == null) {
      if (!user.canAddStudents) set.delete("ADD_STUDENT");
    } else {
      set.add("ADD_STUDENT");
    }
  }
  const { grants } = parseOverrides(user.permissions);
  if (grants) {
    for (const key of Object.keys(grants) as PermissionId[]) {
      if (!(key in PERMISSION_CATALOG)) continue;
      if (grants[key] === true) set.add(key);
      else if (grants[key] === false) set.delete(key);
    }
  }
  return set;
}

/** هل المستخدم عنده الصلاحية دي؟ (فحص السيرفر — المصدر الوحيد للحقيقة) */
export function hasPermission(
  user: { role: string; permissions?: string | null | string[]; canAddStudents?: boolean },
  perm: PermissionId,
): boolean {
  if (user.role === "MANAGER") return true; // المدير: كل الصلاحيات المباشرة
  return resolvePermissions(user).has(perm);
}

/** الصلاحيات كقائمة للسير _للعميل_ (واجهات بتتكيف بيها) */
export function permissionsForClient(
  user: { role: string; permissions?: string | null; canAddStudents?: boolean },
): PermissionId[] {
  return [...resolvePermissions(user)].sort();
}

// ============================= أنواع طلبات الموافقة =============================

export type ApprovalType = "REFUND" | "ADJUSTMENT" | "SESSION_CANCEL" | "STUDENT_CANCEL" | "REGISTRATION_CANCEL";

/** كل نوع طلب: صلاحية التنفيذ المباشر + صلاحية تقديم الطلب + الوصف */
export const APPROVAL_TYPES: Record<ApprovalType, {
  label: string;
  directPerm: PermissionId;
  requestPerm: PermissionId;
  financial: boolean;
}> = {
  REFUND: { label: "استرداد فلوس", directPerm: "REFUND_PAYMENT", requestPerm: "REQUEST_REFUND", financial: true },
  ADJUSTMENT: { label: "تسوية رصيد", directPerm: "ADJUST_BALANCE", requestPerm: "REQUEST_ADJUSTMENT", financial: true },
  SESSION_CANCEL: { label: "إلغاء حصة", directPerm: "CANCEL_SESSION", requestPerm: "REQUEST_SESSION_CANCELLATION", financial: false },
  STUDENT_CANCEL: { label: "أرشفة / إيقاف طالب", directPerm: "ARCHIVE_STUDENT", requestPerm: "REQUEST_STUDENT_CANCEL", financial: false },
  REGISTRATION_CANCEL: { label: "إلغاء تسجيل طالب من مجموعة", directPerm: "CANCEL_SUBSCRIPTION", requestPerm: "REQUEST_CANCELLATION", financial: false },
};

/** المستخدم ينفّذ مباشرة؟ (مدير = دايمًا) */
export function canDirect(
  user: { role: string; permissions?: string | null | string[]; canAddStudents?: boolean },
  type: ApprovalType,
): boolean {
  if (user.role === "MANAGER") return true;
  return hasPermission(user, APPROVAL_TYPES[type].directPerm);
}

/** المستخدم يقدر يقدّم طلب موافقة؟ (مدير مالوش طلبات — هو بياخد القرار) */
export function canRequest(
  user: { role: string; permissions?: string | null | string[]; canAddStudents?: boolean },
  type: ApprovalType,
): boolean {
  if (user.role === "MANAGER") return false;
  return hasPermission(user, APPROVAL_TYPES[type].requestPerm);
}
