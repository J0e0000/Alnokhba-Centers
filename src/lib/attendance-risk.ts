import "server-only";
import { db } from "@/lib/db";

/* ============================================================
   محرك المخاطر للتحضير العام (Lightweight Risk Engine — spec §15)
   ------------------------------------------------------------
   الهدف مش اتهام حد — الهدف إن اللوحة تورّي أنماط غير عادية للأدمن.
   مفيش قرار نهائي آلي ضد طالب: العلم بيظهر للمراجعة البشرية بس.
   IP مجرد إشارة (NAT/واي فاي مشترك) — مش هوية جهاز، ومش بنرفض بسببه (spec §14).

   القيم القابلة للضبط (موثّقة في تقرير QA):
   - RISK_WINDOW_MS              نافذة تحليل المحاولات (10 دقايق)
   - SAME_IP_RAPID_THRESHOLD     أكتر من كام محاولة من نفس الـ IP في نفس الحصة → SAME_IP_RAPID_ATTEMPTS
   - DEVICE_MULTI_STUDENT_N      جهاز واحد جرّب كام كود مختلف → RAPID_MULTI_STUDENT_ATTEMPTS
   - DEVICE_RAPID_THRESHOLD      جهاز واحد عمل كام محاولة → REPEATED_ATTENDANCE_ATTEMPTS
   - STAFF_NOTIFY_SCORE          درجة الخطورة اللي بيبعت تنبيه فوري للموظفين
============================================================ */

export const RISK_WINDOW_MS = 10 * 60_000; // 10 دقايق
export const SAME_IP_RAPID_THRESHOLD = 4; // محاولات من نفس الـ IP لنفس الحصة (الطلبة الشرعية على نفس الواي فاي بيمروا عادي — بنعلّم بس)
export const DEVICE_MULTI_STUDENT_N = 2; // كودين مختلفين من نفس الجهاز في النافذة
export const DEVICE_RAPID_THRESHOLD = 5; // محاولات كتير من نفس الجهاز (رفض/نجاح) في النافذة
export const STAFF_NOTIFY_SCORE = 40;

export const RISK_FLAGS = {
  DEVICE_REUSED: "جهاز اتسجل بيه حضور قبل كده في نفس الحصة",
  MULTIPLE_STUDENTS_SAME_DEVICE: "أكتر من طالب من نفس الجهاز في نفس الحصة",
  RAPID_MULTI_STUDENT_ATTEMPTS: "محاولات متلاحية لأكتر من كود طالب من نفس الجهاز",
  SAME_IP_RAPID_ATTEMPTS: "محاولات كتير من نفس الشبكة (IP مشترك)",
  INVALID_QR_ATTEMPTS: "محاولات بكود QR غير صالح",
  EXPIRED_QR_ATTEMPTS: "محاولات بكود QR منتهي",
  REPEATED_ATTENDANCE_ATTEMPTS: "محاولات حضور متكررة من نفس الجهاز",
  // ===== مضادات الغش (طبقة 2) =====
  STUDENT_CODE_REUSED: "كود طالب اتسجل بيه حضور من جهاز تاني في نفس الحصة (محاولة نيابة)",
  DIFFERENT_NETWORK: "التسجيل من شبكة مختلفة عن شبكة القاعة المرجعية",
  MISSING_FINGERPRINT: "تسجيل من غير بصمة متصفح (متصفح قديم/محجوب) — قفل البصمة مش شغال عليه",
  FINGERPRINT_REUSED: "نفس بصمة المتصفح اتسجل بيه حضور قبل كده في الحصة (إنكوجنتو/مسح بيانات؟)",
} as const;

export type RiskFlag = keyof typeof RISK_FLAGS;

export type RiskAssessment = { score: number; flags: RiskFlag[] };

const WEIGHTS: Record<RiskFlag, number> = {
  DEVICE_REUSED: 30,
  MULTIPLE_STUDENTS_SAME_DEVICE: 50,
  RAPID_MULTI_STUDENT_ATTEMPTS: 40,
  SAME_IP_RAPID_ATTEMPTS: 10,
  INVALID_QR_ATTEMPTS: 15,
  EXPIRED_QR_ATTEMPTS: 10,
  REPEATED_ATTENDANCE_ATTEMPTS: 20,
  STUDENT_CODE_REUSED: 40,
  DIFFERENT_NETWORK: 15,
  MISSING_FINGERPRINT: 5,
  FINGERPRINT_REUSED: 45,
};

/** تقييم مخاطر قبل قبول حضور عام — بيقرأ محاولات الحصة الأخيرة بس (نافذة زمنية) */
export async function assessCheckInRisk(opts: {
  sessionId: string;
  deviceId?: string | null;
  ipAddress?: string | null;
  /** أعلام إضافية محسوبة بره (شبكة مختلفة/بصمة ناقصة…) — بتتراكم مع أعلام السلوك */
  extraFlags?: RiskFlag[];
}): Promise<RiskAssessment> {
  const flags = new Set<RiskFlag>(opts.extraFlags ?? []);
  const since = new Date(Date.now() - RISK_WINDOW_MS);

  const [byDevice, byIp] = await Promise.all([
    opts.deviceId
      ? db.checkInAttempt.findMany({
          where: { sessionId: opts.sessionId, deviceId: opts.deviceId, createdAt: { gte: since } },
          select: { studentCode: true, outcome: true },
        })
      : Promise.resolve([] as { studentCode: string | null; outcome: string }[]),
    opts.ipAddress && opts.ipAddress !== "unknown"
      ? db.checkInAttempt.count({
          where: { sessionId: opts.sessionId, ipAddress: opts.ipAddress, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  // جهاز واحد بيجرّب أكتر من كود طالب مختلف (إشارة أقوى إساءة)
  const distinctCodes = new Set(byDevice.map((a) => a.studentCode).filter(Boolean));
  if (distinctCodes.size >= DEVICE_MULTI_STUDENT_N) flags.add("RAPID_MULTI_STUDENT_ATTEMPTS");
  if (byDevice.length >= DEVICE_RAPID_THRESHOLD) flags.add("REPEATED_ATTENDANCE_ATTEMPTS");

  // نفس الشبكة فيها محاولات كتير (مسموحة — علم للمراجعة بس، مش رفض)
  if (byIp >= SAME_IP_RAPID_THRESHOLD) flags.add("SAME_IP_RAPID_ATTEMPTS");

  const list = Array.from(flags);
  const score = Math.min(100, list.reduce((s, f) => s + (WEIGHTS[f] ?? 0), 0));
  return { score, flags: list };
}

/** تسمية عربية لعلم خطورة (للعرض في اللوحة) */
export function riskFlagLabel(f: string): string {
  return RISK_FLAGS[f as RiskFlag] ?? f;
}

/** صياغة نتيجة المخاطر كنص موجز للوحة/التدقيق */
export function riskSummary(risk: RiskAssessment): string {
  if (!risk.flags.length) return "طبيعي";
  return risk.flags.map(riskFlagLabel).join(" + ");
}
