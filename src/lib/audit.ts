import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

/** Append-only audit trail. Never throws to avoid breaking business flows. */
export async function logAudit(opts: {
  user: SessionUser | { id: string; name: string; centerId?: string | null; support?: SessionUser["support"] };
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}): Promise<void> {
  try {
    // لو العملية حصلت وقت جلسة دعم فني → سجّل من الأدمن باسم مين ولسبب إيه
    // (سجل التدقيق append-only — مفيش تعديل ولا حذف)
    const support = (opts.user as SessionUser).support;
    const reason = support
      ? `${opts.reason ?? ""}${opts.reason ? " — " : ""}[دعم فني: ${support.byAdminName} باسم ${support.targetName} — السبب: ${support.reason} — جلسة ${support.supportId}]`.trim()
      : opts.reason ?? null;
    // anonymous / placeholder ids (failed logins) have no FK row — store as null
    const rawId = opts.user.id;
    const userId = rawId && rawId !== "anonymous" ? rawId : null;
    await db.auditLog.create({
      data: {
        centerId: opts.user.centerId ?? null,
        userId,
        userName: support ? `${opts.user.name} (نيابةً بالدعم)` : opts.user.name,
        action: opts.action,
        entity: opts.entity ?? null,
        entityId: opts.entityId ?? null,
        before: opts.before === undefined ? null : JSON.stringify(opts.before),
        after: opts.after === undefined ? null : JSON.stringify(opts.after),
        reason,
      },
    });
  } catch (e) {
    console.error("audit-log-failed", e);
  }
}

export const AUDIT = {
  STUDENT_CREATED: "إضافة طالب",
  STUDENT_UPDATED: "تعديل بيانات طالب",
  STUDENT_REGISTERED: "تسجيل طالب في مجموعة",
  STUDENT_STATUS_CHANGED: "تغيير حالة طالب",
  ATTENDANCE_RECORDED: "تسجيل حضور",
  ATTENDANCE_EXPORTED: "تصدير كشف حضور CSV",
  ATTENDANCE_UPDATED: "تعديل حضور",
  PAYMENT_RECORDED: "تسجيل دفعة",
  REFUND_ISSUED: "عملية استرداد",
  ADJUSTMENT_MADE: "تسوية رصيد",
  SESSION_OPENED: "فتح حصة",
  SESSION_CLOSED: "قفل حصة",
  SESSION_REOPENED: "إعادة فتح حصة",
  SESSION_CANCELLED: "إلغاء حصة",
  PRICE_CHANGED: "تغيير سعر",
  PERCENT_CHANGED: "تغيير نسبة المدرس",
  EXPENSE_ADDED: "إضافة مصروف",
  TEACHER_PAID: "صرف مستحقات مدرس",
  CASH_OPENED: "فتح الصندوق",
  CASH_CLOSED: "قفل الصندوق",
  TEMPLATE_CREATED: "إضافة قالب واتساب",
  TEMPLATE_UPDATED: "تعديل قالب واتساب",
  TEMPLATE_DELETED: "حذف قالب واتساب",
  BRANDING_UPDATED: "تعديل هوية السنتر",
  STAFF_ADDED: "إضافة موظف",
  STAFF_UPDATED: "تعديل موظف",
  LOGIN: "تسجيل دخول",
  LOGIN_FAILED: "محاولة دخول فاشلة",
  GROUP_CREATED: "إضافة مجموعة",
  GROUP_UPDATED: "تعديل مجموعة",
  TEACHER_CREATED: "إضافة مدرس",
  SUBJECT_CREATED: "إضافة مادة",
  GRADE_CREATED: "إضافة مرحلة",
  SCHEDULE_ADDED: "إضافة حصة في الجدول",
  SCHEDULE_UPDATED: "تعديل جدول",
  SCHEDULE_DELETED: "إلغاء حصة من الجدول",
  ANNOUNCEMENT_PUBLISHED: "نشر إعلان",
  STUDENT_NOTIFIED: "إرسال إشعار للطلاب",
  PORTAL_LOGIN: "دخول طالب للبورتال",
  EMERGENCY_EXPORTED: "تصدير ملف الطوارئ",
  EMERGENCY_IMPORTED: "مزامنة عمليات الطوارئ",
  EMERGENCY_PACKAGE_ISSUED: "إصدار حزمة طوارئ",
  EMERGENCY_RECOVERY_IMPORTED: "استيراد ملف استرداد الطوارئ",
  ROOM_CREATED: "إضافة قاعة",
  ROOM_UPDATED: "تعديل قاعة",
  ROOM_DELETED: "حذف قاعة",
  BOOK_CREATED: "إضافة كتاب",
  BOOK_UPDATED: "تعديل كتاب",
  BOOK_DELETED: "حذف كتاب",
  BOOK_RESTOCKED: "توريد مخزون كتاب",
  BOOK_SOLD: "بيع كتاب",
  BACKUP_CREATED: "إنشاء نسخة احتياطية",
  BACKUP_EXPORTED: "تصدير بيانات",
  BACKUP_DOWNLOADED: "تنزيل نسخة احتياطية",
  RECEIPT_PRINTED: "طباعة إيصال",
  NOTIFICATION_PREPARED: "تحضير رسالة واتساب",
  NOTIFICATION_SENT: "إرسال رسالة واتساب",
  NOTIFICATION_FAILED: "فشل إرسال واتساب",
  QUEUE_CREATED: "إنشاء طابور رسائل",
  QUEUE_SENT: "تأكيد إرسال رسالة من الطابور",
  QUEUE_STOPPED: "إيقاف طابور رسائل",
  SUBSCRIPTION_RENEWED: "تجديد اشتراك",
  CENTER_STATUS_CHANGED: "تغيير حالة سنتر",
  SUPPORT_ACCESS_STARTED: "بدء جلسة دعم فني",
  SUPPORT_ACCESS_ENDED: "إنهاء جلسة دعم فني",
  TEAM_CREATED: "إنشاء فريق",
  TEAM_RENAMED: "تعديل فريق",
  TEAM_STATUS_CHANGED: "تغيير حالة فريق",
  TEAM_MEMBER_ADDED: "إضافة عضو لفريق",
  TEAM_MEMBER_REMOVED: "إزالة عضو من فريق",
  BACKUP_RESTORED: "استعادة من نسخة احتياطية",
  BACKUP_VALIDATED: "التحقق من نسخة احتياطية",
  // الامتحانات والواجبات
  EXAM_CREATED: "إنشاء امتحان",
  EXAM_UPDATED: "تعديل امتحان",
  EXAM_PUBLISHED: "نشر امتحان",
  EXAM_CLOSED: "قفل امتحان",
  EXAM_DELETED: "حذف امتحان",
  EXAM_ATTEMPT_ACTION: "إجراء على محاولة امتحان",
  ASSIGNMENT_CREATED: "إنشاء واجب",
  ASSIGNMENT_UPDATED: "تعديل واجب",
  ASSIGNMENT_PUBLISHED: "نشر واجب",
  ASSIGNMENT_CLOSED: "قفل واجب",
  ASSIGNMENT_DELETED: "حذف واجب",
  ASSIGNMENT_GRADED: "تصحيح واجب",
  // QR الحضور
  QR_ISSUED: "توليد كود QR حضور",
  QR_SCAN_SUCCESS: "تسجيل حضور بـ QR",
  QR_SCAN_EXPIRED: "محاولة حضور بكود منتهي",
  QR_SCAN_REPLAY: "إعادة استخدام كود QR",
  DUPLICATE_ATTENDANCE: "محاولة حضور مكررة",
  UNAUTHORIZED_ATTENDANCE: "محاولة حضور غير مصرح بها",
  // قدرات المركز + الحضور الموحد
  CAPABILITIES_UPDATED: "تعديل ميزات المركز",
  SCHEMA_SYNC: "مزامنة سكيما قاعدة البيانات",
  STAFF_CHECKIN: "حضور موظف",
  TEACHER_AUTO_ATTENDANCE: "حضور المدرس التلقائي (بدء الحصة)",
  STAFF_QR_ISSUED: "توليد كود حضور موظفين",
  FINGERPRINT_ENROLLED: "تسجيل بصمة",
  FINGERPRINT_EVENT: "حدث حضور ببصمة",
  DEVICE_ADDED: "إضافة جهاز حضور",
  DEVICE_REMOVED: "إيقاف جهاز حضور",
  // الحضور العام بقفل الجهاز (device-locked)
  PUBLIC_CHECKIN_REJECTED: "رفض محاولة حضور عام",
  DEVICE_ALREADY_USED: "رفض — جهاز اتسجل بيه حضور في نفس الحصة",
  SUSPICIOUS_ACTIVITY: "اكتشاف نشاط مشبوه في الحضور",
  // الوكيل الذكي (زكي Agent)
  AGENT_TASK_CREATED: "مهمة وكيل ذكي",
  AGENT_TASK_COMPLETED: "اكتمال مهمة الوكيل",
  AGENT_TASK_FAILED: "فشل مهمة الوكيل",
  AGENT_TASK_CANCELLED: "إلغاء مهمة الوكيل",
  AGENT_TOOL_EXECUTED: "تنفيذ أداة عبر الوكيل",
  AGENT_TOOL_BLOCKED: "حجب أداة عن الوكيل (صلاحية)",
  AGENT_CONFIRMATION_GRANTED: "تأكيد عملية الوكيل",
  AGENT_CONFIRMATION_CANCELLED: "إلغاء تأكيد عملية الوكيل",
  AGENT_FEEDBACK: "تقييم رد الوكيل",
} as const;
