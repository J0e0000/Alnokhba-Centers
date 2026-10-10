import "server-only";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";

/* ============================================================
   الأجهزة الموثوقة (Trusted Device Binding) — Master Prompt §10
   ------------------------------------------------------------
   القاعدة: طالب واحد = جهاز موثوق واحد نشط في السنتر.
   - الربط بيحصل بعد أول حضور ناجح مُتحقق منه بس (مش من محاولة فاشلة)
   - الجهاز المرتبط ميعرفش يسجّل طالب تاني (رفض + حدث أمني)
   - الطالب المرتبط ميعرفش يسجّل من جهاز تاني (رفض محايد + استرجاع إداري)
   - بنخزن hash(deviceId + centerId) — تسريب قاعدة البيانات مبيديش هويات أجهزة
   - حدود المتصفح معلنة: مسح الكوكي/تغيير المتصفح = جهاز "جديد" هيحتاج
     استرجاع إداري — وده part of the design مش bug (كشف + تدقيق)
============================================================ */

/** verifier الجهاز — hash موحد لكل السنترات */
export function deviceVerifier(centerId: string, deviceId: string): string {
  return createHash("sha256").update(`${centerId}:${deviceId}`).digest("hex");
}

export type TrustedVerdict =
  | { action: "ALLOW"; bindingId: string }
  | { action: "BIND" } // الطالب ليه جهاز — الجهاز ده جديد: اربطه بعد نجاح الحضور
  | { action: "REJECT"; reason: "STUDENT_BOUND_TO_OTHER_DEVICE" | "DEVICE_BOUND_TO_OTHER_STUDENT" };

/**
 * تقييم ثنائي (طالب × جهاز) — قراءة بس، الكتابة بعد نجاح الحضور.
 * التقييم في الاتجاهين عشان نمنع تبديل الهوية من الطرفين:
 *   1) الطالب مربوط بجهاز تاني → REJECT
 *   2) الجهاز مربوط بطالب تاني → REJECT
 *   3) الطالب من غير ربط → BIND (بعد نجاح الحضور)
 *   4) مربوط بنفس الجهاز → ALLOW
 */
export async function evaluateTrustedDevice(centerId: string, studentId: string, deviceId: string): Promise<TrustedVerdict> {
  const verifier = deviceVerifier(centerId, deviceId);
  const [studentBinding, deviceBinding] = await Promise.all([
    db.trustedDeviceBinding.findFirst({ where: { centerId, studentId, status: "ACTIVE" } }),
    db.trustedDeviceBinding.findFirst({ where: { centerId, deviceId, status: "ACTIVE" } }),
  ]);

  if (studentBinding) {
    if (studentBinding.deviceHash === verifier) return { action: "ALLOW", bindingId: studentBinding.id };
    return { action: "REJECT", reason: "STUDENT_BOUND_TO_OTHER_DEVICE" };
  }
  if (deviceBinding) {
    return { action: "REJECT", reason: "DEVICE_BOUND_TO_OTHER_STUDENT" };
  }
  return { action: "BIND" };
}

/** إنشاء الربط — بعد نجاح تسجيل الحضور بس (idempotent — الربط مش بيتعاد) */
export async function bindTrustedDevice(centerId: string, studentId: string, deviceId: string): Promise<void> {
  const verifier = deviceVerifier(centerId, deviceId);
  // سباق نادر بين جهازين لنفس الطالب: unique(studentId) بيحسم — أول واحد يكسب
  await db.trustedDeviceBinding.create({
    data: { centerId, studentId, deviceId, deviceHash: verifier },
  }).catch(() => {}); // موجود خلاص — سيبه
  // حدّث آخر استخدام لو الربط موجود
  await db.trustedDeviceBinding.updateMany({
    where: { centerId, studentId, status: "ACTIVE", deviceHash: verifier },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
}

/** لمسة استخدام — بعد كل حضور ناجح من الجهاز المرتبط */
export async function touchTrustedDevice(centerId: string, studentId: string, deviceId: string): Promise<void> {
  const verifier = deviceVerifier(centerId, deviceId);
  await db.trustedDeviceBinding.updateMany({
    where: { centerId, studentId, status: "ACTIVE", deviceHash: verifier },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
}

/** سحب الربط (استرجاع إداري) — السبب إلزامي وبيتدقق */
export async function revokeTrustedDevice(opts: {
  centerId: string;
  studentId: string;
  byUserId: string;
  byUserName: string;
  reason: string;
}): Promise<boolean> {
  if (opts.reason.trim().length < 3) throw new ApiError("اكتب سبب سحب الجهاز (3 حروف على الأقل) — العملية دي مُدقّقة.", 400);
  const binding = await db.trustedDeviceBinding.findFirst({
    where: { centerId: opts.centerId, studentId: opts.studentId, status: "ACTIVE" },
  });
  if (!binding) return false;
  await db.trustedDeviceBinding.update({
    where: { id: binding.id },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedById: opts.byUserId,
      revokedByName: opts.byUserName,
      revokeReason: opts.reason.trim().slice(0, 300),
    },
  });
  return true;
}

/** قائمة الأجهزة الموثوقة لسنتر (للوحة الإدارة — من غير أسرار) */
export async function listTrustedDevices(centerId: string) {
  const rows = await db.trustedDeviceBinding.findMany({
    where: { centerId },
    orderBy: { boundAt: "desc" },
    take: 200,
    include: { student: { select: { name: true, code: true, status: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    studentName: r.student?.name ?? "—",
    studentCode: r.student?.code ?? "—",
    studentStatus: r.student?.status ?? null,
    boundAt: r.boundAt,
    lastUsedAt: r.lastUsedAt,
    status: r.status,
    revokedAt: r.revokedAt,
    revokedByName: r.revokedByName,
    revokeReason: r.revokeReason,
    deviceTail: r.deviceHash.slice(-6), // مش الهوية — للتعرّف البصري بس
  }));
}
