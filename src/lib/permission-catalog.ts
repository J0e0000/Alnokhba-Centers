/* ============================================================
   كتالوج الصلاحيات الدقيقة — نسخة مشتركة (client + server)
   ------------------------------------------------------------
   - الملف ده مشترك عمدًا (ممنوع server-only هنا) — شاشات الإعدادات
     ولوحة الأدمن بتعرض نفس الكتالوج اللي السيرفر بيفحص بيه.
   - التعريفات الحاكمة (resolvePermissions / hasPermission) في
     permissions.ts على السيرفر — هنا الكتالوج والافتراضيات بس.
============================================================ */

export type PermissionId =
  | "VIEW_STUDENTS" | "SEARCH_STUDENTS" | "VIEW_STUDENT_FINANCIAL_STATUS"
  | "RECORD_PAYMENT" | "EDIT_PAYMENT" | "REFUND_PAYMENT" | "REQUEST_REFUND"
  | "CANCEL_SUBSCRIPTION" | "REQUEST_CANCELLATION"
  | "EDIT_BALANCE" | "ADJUST_BALANCE" | "REQUEST_ADJUSTMENT"
  | "START_SESSION" | "END_SESSION" | "CANCEL_SESSION" | "REQUEST_SESSION_CANCELLATION"
  | "EDIT_ATTENDANCE" | "EDIT_STUDENT" | "ADD_STUDENT" | "EDIT_GROUP"
  | "VIEW_REPORTS" | "EXPORT_REPORTS"
  | "ARCHIVE_STUDENT" | "REQUEST_STUDENT_CANCEL";

export type PermissionGroup = "core" | "financial" | "sessions" | "students" | "reports";

/** كل صلاحية: وصف مصري واضح + المجموعة + هل دي صلاحية حساسة (بتتحكم من لوحة المدير) */
export const PERMISSION_CATALOG: Record<PermissionId, { label: string; desc: string; group: PermissionGroup; sensitive: boolean }> = {
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

export const PERMISSION_IDS = Object.keys(PERMISSION_CATALOG) as PermissionId[];

export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
  core: "عام",
  students: "الطلاب",
  financial: "المالية",
  sessions: "الحصص والحضور",
  reports: "التقارير",
};

/** الصلاحيات الحساسة اللي بتظهر في لوحة تحكم المدير */
export const SENSITIVE_PERMISSIONS = PERMISSION_IDS.filter((p) => PERMISSION_CATALOG[p].sensitive);

/** استقبال: عمليات يومية + حق الطلب للحساسات (مش تنفيذ مباشر) — نفس سيرفر permissions.ts */
export const RECEPTIONIST_DEFAULT: PermissionId[] = [
  "VIEW_STUDENTS", "SEARCH_STUDENTS", "VIEW_STUDENT_FINANCIAL_STATUS",
  "RECORD_PAYMENT", "START_SESSION", "END_SESSION", "EDIT_ATTENDANCE",
  "EDIT_STUDENT", "VIEW_REPORTS",
  "REQUEST_REFUND", "REQUEST_ADJUSTMENT", "REQUEST_SESSION_CANCELLATION",
  "REQUEST_CANCELLATION", "REQUEST_STUDENT_CANCEL",
];

/** زوج الطلب: صلاحية التنفيذ المباشر → صلاحية الطلب المكملة ليها */
export const DIRECT_TO_REQUEST: Partial<Record<PermissionId, PermissionId>> = {
  REFUND_PAYMENT: "REQUEST_REFUND",
  ADJUST_BALANCE: "REQUEST_ADJUSTMENT",
  CANCEL_SESSION: "REQUEST_SESSION_CANCELLATION",
  ARCHIVE_STUDENT: "REQUEST_STUDENT_CANCEL",
  CANCEL_SUBSCRIPTION: "REQUEST_CANCELLATION",
};

/** يبني grants صريحة من قائمة صلاحيات محسومة — عشان محرر الواجهة يشتغل تدريجي.
 *  كل صلاحية بتتكتب true/false صراحة (الافتراضي بيتحسب من الدور). */
export function buildGrantsFromResolved(resolved: string[], role: string): Record<string, boolean> {
  const defaults = role === "RECEPTIONIST" ? RECEPTIONIST_DEFAULT : [];
  const grants: Record<string, boolean> = {};
  for (const p of PERMISSION_IDS) {
    if (p === "ADD_STUDENT") continue; // بتتحكم فيها مع canAddStudents على حدة
    grants[p] = resolved.includes(p);
    void defaults;
  }
  return grants;
}
