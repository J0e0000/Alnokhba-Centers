import "server-only";
import type { SessionUser } from "@/lib/auth";

/* ============================================================
   نظام الصلاحيات الدقيقة (Granular Permissions)
   ------------------------------------------------------------
   - المدير بيتحكم في كل صلاحية لموظفي الاستقبال (من إدارة الموظفين).
   - التخزين: User.permissions JSON — بس الفروقات عن افتراضي الدور.
   - الفحص بيحصل على السيرفر دايمًا (مفيش إخفاء زرار بيحسب أمان).
   - التمييز: صلاحية مباشرة (Direct) vs صلاحية طلب موافقة (Request).
============================================================ */

// ============================= الكتالوج =============================

export type PermissionId =
  | "VIEW_STUDENTS" | "SEARCH_STUDENTS" | "VIEW_STUDENT_FINANCIAL_STATUS"
  | "RECORD_PAYMENT" | "EDIT_PAYMENT" | "REFUND_PAYMENT" | "REQUEST_REFUND"
  | "CANCEL_SUBSCRIPTION" | "REQUEST_CANCELLATION"
  | "EDIT_BALANCE" | "ADJUST_BALANCE" | "REQUEST_ADJUSTMENT"
  | "START_SESSION" | "END_SESSION" | "CANCEL_SESSION" | "REQUEST_SESSION_CANCELLATION"
  | "EDIT_ATTENDANCE" | "EDIT_STUDENT" | "ADD_STUDENT" | "EDIT_GROUP"
  | "VIEW_REPORTS" | "EXPORT_REPORTS"
  | "ARCHIVE_STUDENT" | "REQUEST_STUDENT_CANCEL";

/** كل صلاحية: وصف مصري واضح + المجموعة + هل دي صلاحية حساسة (بتتحكم من لوحة المدير) */
export const PERMISSION_CATALOG: Record<PermissionId, { label: string; desc: string; group: "core" | "financial" | "sessions" | "students" | "reports"; sensitive: boolean }> = {
  VIEW_STUDENTS: { label: "عرض الطلاب", desc: "يشوف ملفات الطلاب وأكوادهم", group: "students", sensitive: false },
  SEARCH_STUDENTS: { label: "البحث عن الطلاب", desc: "البحث بالاسم/الكود/الموبايل", group: "students", sensitive: false },
  VIEW_STUDENT_FINANCIAL_STATUS: { label: "عرض الحالة المالية", desc: "يشوف رصيد الطالب وكشف حسابه", group: "financial", sensitive: false },
  RECORD_PAYMENT: { label: "تسجيل الدفعات", desc: "بيسجل دفعات الطلاب بإيصالات", group: "financial", sensitive: false },
  EDIT_PAYMENT: { label: "تعديل الدفعات", desc: "يعدّل بيانات دفعة مسجلة", group: "financial", sensitive: true },
  REFUND_PAYMENT: { label: "استرداد فوري", desc: "ينفّذ استرداد فلوس من غير انتظار موافقة", group: "financial", sensitive: true },
  REQUEST_REFUND: { label: "طلب استرداد", desc: "يبعت طلب استرداد للمدير يقرره", group: "financial", sensitive: true },
  CANCEL_SUBSCRIPTION: { label: "إلغاء تسجيل مباشر", desc: "يشيل تسجيل طالب من مجموعة فورًا", group: "students", sensitive: true },
  REQUEST_CANCELLATION: { label: "طلب إلغاء تسجيل", desc: "يبعت طلب إلغاء تسجيل للمدير", group: "students", sensitive: true },
  EDIT_BALANCE: { label: "تعديل الرصيد", desc: "يعدّل رصيد الطالب يدويًا", group: "financial", sensitive: true },
  ADJUST_BALANCE: { label: "تسوية فورية", desc: "ينفّذ تسوية رصيد من غير موافقة", group: "financial", sensitive: true },
  REQUEST_ADJUSTMENT: { label: "طلب تسوية", desc: "يبعت طلب تسوية رصيد للمدير", group: "financial", sensitive: true },
  START_SESSION: { label: "فتح الحصص", desc: "يفتح حصة من الجدول", group: "sessions", sensitive: false },
  END_SESSION: { label: "قفل الحصص", desc: "يقفل الحصة ويثبّت حساباتها", group: "sessions", sensitive: false },
  CANCEL_SESSION: { label: "إلغاء حصة فوري", desc: "يلغي حصة من غير انتظار موافقة", group: "sessions", sensitive: true },
  REQUEST_SESSION_CANCELLATION: { label: "طلب إلغاء حصة", desc: "يبعت طلب إلغاء حصة للمدير", group: "sessions", sensitive: true },
  EDIT_ATTENDANCE: { label: "تعديل الحضور", desc: "يصحّح حضور طالب بعد التسجيل", group: "sessions", sensitive: false },
  EDIT_STUDENT: { label: "تعديل بيانات طالب", desc: "يعدّل تليفون/ولي أمر/ملاحظات", group: "students", sensitive: false },
  ADD_STUDENT: { label: "إضافة طلاب جدد", desc: "يسجّل طالب جديد (زي canAddStudents القديمة)", group: "students", sensitive: false },
  EDIT_GROUP: { label: "تعديل المجموعات", desc: "يعدّل أسعار ونسب المجموعات", group: "students", sensitive: true },
  VIEW_REPORTS: { label: "عرض التقارير", desc: "يشوف تقارير الحضور والتحصيل", group: "reports", sensitive: false },
  EXPORT_REPORTS: { label: "تصدير التقارير", desc: "ينزّل التقارير CSV/Excel", group: "reports", sensitive: true },
  ARCHIVE_STUDENT: { label: "أرشفة طالب فوري", desc: "يؤرشف/يوقف طالب من غير موافقة", group: "students", sensitive: true },
  REQUEST_STUDENT_CANCEL: { label: "طلب أرشفة طالب", desc: "يبعت طلب أرشفة/إيقاف طالب للمدير", group: "students", sensitive: true },
};

/** الصلاحيات الحساسة اللي بتظهر في لوحة تحكم المدير */
export const SENSITIVE_PERMISSIONS = (Object.keys(PERMISSION_CATALOG) as PermissionId[])
  .filter((p) => PERMISSION_CATALOG[p].sensitive);

// ============================= افتراضيات الأدوار =============================

/** المدير: كل حاجة مباشرة */
const MANAGER_DEFAULT: PermissionId[] = (Object.keys(PERMISSION_CATALOG) as PermissionId[]);

/** استقبال: عمليات يومية + حق الطلب للحساسات (مش تنفيذ مباشر) */
const RECEPTION_DEFAULT: PermissionId[] = [
  "VIEW_STUDENTS", "SEARCH_STUDENTS", "VIEW_STUDENT_FINANCIAL_STATUS",
  "RECORD_PAYMENT", "START_SESSION", "END_SESSION", "EDIT_ATTENDANCE",
  "EDIT_STUDENT", "VIEW_REPORTS",
  "REQUEST_REFUND", "REQUEST_ADJUSTMENT", "REQUEST_SESSION_CANCELLATION",
  "REQUEST_CANCELLATION", "REQUEST_STUDENT_CANCEL",
];

/** أدمن المنصة: مالوش صلاحيات سنتر — بورتال الأدمن منفصل تمامًا */

export function roleDefaults(role: string): Set<PermissionId> {
  if (role === "MANAGER") return new Set(MANAGER_DEFAULT);
  if (role === "RECEPTIONIST") return new Set(RECEPTION_DEFAULT);
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
