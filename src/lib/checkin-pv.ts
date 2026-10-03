import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/* ============================================================
   إثبات "شاف الكود وهو حي" — نافذة سماح موقّعة (Grace Window — spec §4)
   ------------------------------------------------------------
   المشكلة: الطالب يمسح الكود وهو حي وبعدين يقعد يكتب كوده 20-40 ثانية —
   في الوقت ده كود السلوت (10ث + هامش 4ث) بيكون مات. لو السماح كانت "وقت
   ثابت بعد الانتهاء" لأي حد، السكرين شوت المتبعت لحد بره الحصة هتبقى شغالة
   كل المدة دي — وده بيكسر مبدأ مكافحة التصوير بتاع Slot QR.

   الحل (server-authoritative من غير تخزين):
   - /peek (عام): لو التوكن نشط ومنتهي الصلاحية "دلوقتي" → السيرفر يوقّع
     إثبات sighting مربوط بـ (qrId + deviceId + لحظة الإصدار iat).
   - /check-in: التوكن ممكن يكون منتهي/متدوّر — بشرط إثبات sighting صالح:
       1) التوقيع HMAC سليم (مفيش تلاعب)
       2) نفس qrId ونفس deviceId
       3) iat ≤ انتهاء صلاحية التوكن (يعني الإثبات اتولّد والكود لسه حي)
       4) الآن − iat ≤ QR_CLAIM_GRACE_MS (نافذة السماح للطالب اللي بيكتب كوده)
   - السكرين شوت المتتبعت لحد بعيد: الـ peek بتاعه بيحصل بعد ما الكود مات
     → مفيش إثبات → رفض. ولو جرب يحط إثبات قديم → العمر بيقتله.
   - إعادة المحاولة/الريفرش: الإثبات نفسه بيتعاد استخدامه في النافذة (idempotent) —
     ومفيش حالة مكررة لأن قفل الجهاز/Databse هو الحاكم النهائي.

   كل التوقيتات من السيرفر — الثقة في الزمن من العميل = صفر (spec §10).
============================================================ */

/** نافذة السماح بعد sighting حي: 90 ثانية (قابلة للضبط — موثّقة في QA) */
export const QR_CLAIM_GRACE_MS = 90_000;
/** سماح توقيت بسيط بين السيرفرات (ثواني معدودة) */
const CLOCK_SKEW_MS = 3_000;

const SECRET = process.env.NOKHBA_PV_SECRET || "nk-pv-secret-v1";

function hmac(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

/** إصدار إثبات sighting جديد (بيستدعى من peek فقط لما التوكن يكون حي) */
export function issueSightingPv(qrId: string, deviceId: string): { pv: string; iat: number } {
  const iat = Date.now();
  const payload = `${qrId}|${deviceId}|${iat}`;
  return { pv: `${Buffer.from(payload).toString("base64url")}.${hmac(payload)}`, iat };
}

export type PvVerify =
  | { ok: true }
  | { ok: false; reason: "FORMAT" | "QR_MISMATCH" | "DEVICE_MISMATCH" | "NOT_LIVE" | "STALE" };

/**
 * التحقق من إثبات sighting:
 * @param pv            اللي بعتته الصفحة
 * @param qrId          معرّف صف التوكن الحالي
 * @param deviceId      معرّف الجهاز من الطلب (لازم نفس اللي شاف الكود)
 * @param tokenExpiresAt انتهاء صلاحية التوكن — الإثبات لازم يكون اتولّد وهو الكود حي
 */
export function verifySightingPv(
  pv: string,
  qrId: string,
  deviceId: string,
  tokenExpiresAt: Date,
): PvVerify {
  const dot = pv.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "FORMAT" };
  let payload: string;
  try {
    payload = Buffer.from(pv.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "FORMAT" };
  }
  const parts = payload.split("|");
  if (parts.length !== 3) return { ok: false, reason: "FORMAT" };
  const [pQr, pDevice, pIat] = parts;
  const iat = Number(pIat);
  if (!Number.isFinite(iat) || iat <= 0) return { ok: false, reason: "FORMAT" };

  const expected = Buffer.from(hmac(payload));
  const got = Buffer.from(pv.slice(dot + 1));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: "FORMAT" };
  }
  if (pQr !== qrId) return { ok: false, reason: "QR_MISMATCH" };
  if (pDevice !== deviceId) return { ok: false, reason: "DEVICE_MISMATCH" };
  // الإثبات لازم يكون اتولّد والكود لسه حي (بدقة ساعة معقولة)
  if (iat > tokenExpiresAt.getTime() + CLOCK_SKEW_MS) return { ok: false, reason: "NOT_LIVE" };
  // ونافذة السماح لسه شغالة
  if (Date.now() - iat > QR_CLAIM_GRACE_MS) return { ok: false, reason: "STALE" };
  return { ok: true };
}
