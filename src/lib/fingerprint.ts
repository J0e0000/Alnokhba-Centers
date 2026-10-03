import "server-only";
import { createHash } from "crypto";

/* ============================================================
   طبقة تكامل البصمة (Fingerprint Integration Layer)
   ------------------------------------------------------------
   البصمة عتاد خارجي — المتصفح مبيقدرش يقرا بصمات خام، والنواة
   (AttendanceEvent) مستقلة تمامًا عن الهاردوير. الطبقة دي بس بتحوّل
   رد الجهاز لحدث حضور موحّد.

   وضعا التشغيل:
   1) DEVICE_MATCHED (الوضع الحقيقي): جهاز البصمة/الـ SDK بيعمل المطابقة
      محليًا على القوالب المسجلة عنده وبيبعت templateHash للمطابق.
   2) SERVER_MATCH (اختبار/تكامل مبسّط): الطرف بيبعت template خام،
      والسيرفر بيعمل hash ويطابق ضد البصمات المسجلة (exact hash match).

   أي تكامل مستقبلي (SDK محلي، خدمة سحابية...) بيستخدم نفس الواجهة:
   enroll = hash(template) → FingerprintEnrollment
   verify = template/templateHash → matched enrollment
============================================================ */

export type FingerprintVerifyInput = {
  template?: string; // قالب خام من الجهاز (SERVER_MATCH)
  templateHash?: string; // هاش المطابقة من جهاز بيعمل المطابقة بنفسه (DEVICE_MATCHED)
};

export type FingerprintVerifyResult = {
  matched: boolean;
  enrollmentId?: string;
  displayName?: string;
  personType?: string;
  studentId?: string | null;
  userId?: string | null;
  teacherId?: string | null;
  mode: "DEVICE_MATCHED" | "SERVER_MATCH";
};

/** هاش القالب — نفس الدالة للتسجيل والمطابقة (sha256 hex) */
export function fingerprintTemplateHash(template: string): string {
  return createHash("sha256").update(template.trim()).digest("hex");
}

/** مطابقة ضد بصمات المركز المسجلة (server-side exact-hash match) */
export async function verifyFingerprint(
  centerId: string,
  input: FingerprintVerifyInput,
  activeEnrollments: Array<{
    id: string; templateHash: string; displayName: string; personType: string;
    studentId: string | null; userId: string | null; teacherId: string | null;
  }>,
): Promise<FingerprintVerifyResult> {
  // وضع DEVICE_MATCHED — الجهاز مطابق محليًا وبيبعت الهاش المطابق
  if (input.templateHash) {
    const hit = activeEnrollments.find((e) => e.templateHash === input.templateHash!.toLowerCase());
    if (!hit) return { matched: false, mode: "DEVICE_MATCHED" };
    return {
      matched: true, enrollmentId: hit.id, displayName: hit.displayName,
      personType: hit.personType, studentId: hit.studentId, userId: hit.userId, teacherId: hit.teacherId,
      mode: "DEVICE_MATCHED",
    };
  }
  // وضع SERVER_MATCH — قالب خام بيتعمله hash ويطابق
  if (input.template) {
    const hash = fingerprintTemplateHash(input.template);
    const hit = activeEnrollments.find((e) => e.templateHash === hash);
    if (!hit) return { matched: false, mode: "SERVER_MATCH" };
    return {
      matched: true, enrollmentId: hit.id, displayName: hit.displayName,
      personType: hit.personType, studentId: hit.studentId, userId: hit.userId, teacherId: hit.teacherId,
      mode: "SERVER_MATCH",
    };
  }
  return { matched: false, mode: "DEVICE_MATCHED" };
}
