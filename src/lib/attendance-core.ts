import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireCapability, getCenterCapabilities } from "@/lib/center-capabilities";
import type { CapabilityKey } from "@/lib/capabilities";
import { cairoDateStr } from "@/lib/normalize";

/* ============================================================
   نواة الحضور الموحّدة (Unified Attendance Core)
   ------------------------------------------------------------
   «الحضور» هو المفهوم الأساسي — كل الطرق (اسم / QR ثابت / QR متغير /
   بدء الحصة / بصمة) مجرد METHODS بتنتج حدث حضور واحد بنفس الشكل:
     personType + role + method + status + timestamp + sessionId? + deviceId?
   - إضافة طريقة جديدة مستقبلًا = مفتاح جديد هنا من غير إعادة كتابة النواة.
   - جدول Attendance (حصص الطلاب) بيفضل هو السجل التشغيلي بالشحن —
     وكل عملية ناجحة عليه بتبعت حدث موحّد لسجل الأحداث (تدقيق/تقارير).
   - كل بوابة طريقة بتمر على قدرة المركز (Center Capability).
============================================================ */

/** الطريقة الموحّدة → قدرة المركز اللي بتصرّح بيها */
export const METHOD_CAPABILITY: Record<AttendanceMethod, CapabilityKey> = {
  NAME: "name_attendance",
  STATIC_QR: "static_qr",
  DYNAMIC_QR: "dynamic_qr",
  SESSION_START: "teacher_auto_attendance",
  FINGERPRINT: "fingerprint",
};

/** الطريقة الموحّدة → قيمة Attendance.method المخزنة في جدول الحصص (توافق عكسي) */
export const ATTENDANCE_TABLE_METHOD: Record<AttendanceMethod, string> = {
  NAME: "MANUAL",
  STATIC_QR: "QR_SCAN",
  DYNAMIC_QR: "SESSION_QR",
  SESSION_START: "MANUAL",
  FINGERPRINT: "FINGERPRINT",
};

/** طرق الحضور الموحدة المدعومة حاليًا */
export type AttendanceMethod =
  | "NAME"
  | "STATIC_QR"
  | "DYNAMIC_QR"
  | "SESSION_START"
  | "FINGERPRINT";

export function isAttendanceMethod(m: string): m is AttendanceMethod {
  return m in METHOD_CAPABILITY;
}

/** تحويل method جدول الحصص القديم → الطريقة الموحدة */
export function unifiedMethodFromTableMethod(m: string): AttendanceMethod {
  if (m === "QR_SCAN") return "STATIC_QR";
  if (m === "SESSION_QR") return "DYNAMIC_QR";
  if (m === "FINGERPRINT") return "FINGERPRINT";
  return "NAME";
}

/**
 * بوابة الطريقة: القدرة لازم تكون مفعّلة على المركز.
 * بتقبل الطريقة الموحدة أو قيمة جدول الحصص القديمة (MANUAL/QR_SCAN/SESSION_QR).
 */
export async function assertAttendanceMethodAllowed(centerId: string, method: string): Promise<void> {
  const unified = isAttendanceMethod(method) ? method : unifiedMethodFromTableMethod(method);
  if (unified === "SESSION_START") return; // بتتفحص في مسار بدء الحصة نفسه
  await requireCapability(centerId, METHOD_CAPABILITY[unified]);
}

/** بوابة الحالة: LATE محتاج قدرة late_checkin */
export async function assertAttendanceStatusAllowed(centerId: string, status: string): Promise<void> {
  if (status === "LATE") await requireCapability(centerId, "late_checkin");
}

export type AttendanceEventInput = {
  centerId: string;
  personType: "STUDENT" | "STAFF";
  method: AttendanceMethod;
  status?: string; // PRESENT | LATE | EXCUSED | CHECK_IN (default PRESENT)
  studentId?: string | null;
  userId?: string | null;
  teacherId?: string | null;
  displayName: string;
  role?: string | null;
  sessionId?: string | null;
  deviceId?: string | null;
  metadata?: Record<string, unknown>;
};

/** كتابة حدث حضور موحّد — آمنة (مبتكسّرش الفلو لو فشلت، إلا لو متطلب صراحةً) */
export async function recordAttendanceEvent(input: AttendanceEventInput, opts?: { critical?: boolean }): Promise<string | null> {
  const data = {
    centerId: input.centerId,
    personType: input.personType,
    studentId: input.studentId ?? null,
    userId: input.userId ?? null,
    teacherId: input.teacherId ?? null,
    displayName: input.displayName,
    role: input.role ?? null,
    method: input.method,
    status: input.status ?? "PRESENT",
    sessionId: input.sessionId ?? null,
    deviceId: input.deviceId ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  };
  try {
    const row = await db.attendanceEvent.create({ data });
    return row.id;
  } catch (e) {
    if (opts?.critical) throw e;
    console.error("[attendance-event-write-failed]", e);
    return null;
  }
}

/** هل الشخص ده عنده حدث حضور (أي طريقة) في يوم القاهرة الحالي؟ */
export async function hasAttendanceEventToday(opts: {
  centerId: string;
  userId?: string | null;
  teacherId?: string | null;
  studentId?: string | null;
}): Promise<boolean> {
  const since = new Date(Date.now() - 36 * 3600 * 1000); // نافذة واسعة + فلترة بتوقيت القاهرة
  const ev = await db.attendanceEvent.findFirst({
    where: {
      centerId: opts.centerId,
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.teacherId ? { teacherId: opts.teacherId } : {}),
      ...(opts.studentId ? { studentId: opts.studentId } : {}),
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return !!ev && cairoDateStr(ev.occurredAt) === cairoDateStr(new Date());
}

/**
 * إثبات حضور مادي (في المركز فعلًا): QR شاشة المركز أو البصمة أو مسح كارت
 * — SESSION_START مش دليل مادي (بأنه معندوش يوم)، فبيستثنى من البوابة دي.
 */
export async function hasPhysicalAttendanceToday(opts: {
  centerId: string;
  userId?: string | null;
  teacherId?: string | null;
}): Promise<boolean> {
  const since = new Date(Date.now() - 36 * 3600 * 1000);
  const ev = await db.attendanceEvent.findFirst({
    where: {
      centerId: opts.centerId,
      method: { in: ["DYNAMIC_QR", "FINGERPRINT", "STATIC_QR", "NAME"] },
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.teacherId ? { teacherId: opts.teacherId } : {}),
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return !!ev && cairoDateStr(ev.occurredAt) === cairoDateStr(new Date());
}

/** قدرات المركز (اختصار) */
export async function capsFor(centerId: string) {
  return getCenterCapabilities(centerId);
}
