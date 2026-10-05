import "server-only";
import { createHmac } from "crypto";

/* ============================================================
   كود القاعة المتغيّر (Rotating Room PIN — طبقة مكافحة مشاركة الكود)
   ------------------------------------------------------------
   الهجوم اللي بيقفله: طالب جوه القاعة يصوّر الـ QR ويبعته لحصل بره
   القاعة (صاحبه الغايب) — الصاحب يمسح الصورة ويسجّل حضور وهو مش موجود.

   ليه الـ QR لوحده مش كفاية؟ لأن سلوت الـ QR فيه نافذة حقيقية
   (5..60ث): الصورة اللي اتبعت جوه النافذة دي ممكن تتسح وتتسجل
   قبل ما الكود يموت (والـ pv بيدي سماح 90ث للي شافه حي).

   الفكرة: جنب الـ QR على شاشة الحصة بيظهر كود 4 أرقام بيتبدّل كل
   دقيقتين — مشتق HMAC من معرّف الحصة + رقم النافذة الزمنية (سرّ
   السيرفر — مش قابل للتخمين من بره). الطالب يكتبه مع اسمه وكوده.

   الصاحب اللي بره القاعة محتاج كود القاعة الحالي بنفس اللحظة — يعني
   الغش بيفضل محتاج حد جوه القاعة يبعت «QR + PIN» كل دقيقتين —
   يعني عمليًا موصل حي متزامن، وده نفس مجهود إنه يحضر بنفسه.

   التوقيت من السيرفر بالكامل (الثقة في ساعة العميل = صفر):
   - النافذة الحالية + اللي قبلها مقبولين (سماح للي كان بيكتب والكود اتغيّر).
   - إعادة إرسال بنفس الكود بعد تغييره مرتين → مرفوض.
============================================================ */

/** مدة نافذة كود القاعة: 120 ثانية (قابلة للتعديل — موثّقة في docs) */
export const ROOM_PIN_WINDOW_MS = 120_000;

const SECRET = process.env.NOKHBA_PV_SECRET || "nk-pv-secret-v1";

function pinForWindow(sessionId: string, windowIndex: number): string {
  const h = createHmac("sha256", SECRET).update(`roompin|${sessionId}|${windowIndex}`).digest("hex");
  // أول 8 حروف hex → رقم موزّع بانتظام على 0000..9999
  const n = parseInt(h.slice(0, 8), 16) % 10000;
  return String(n).padStart(4, "0");
}

export type RoomPinInfo = {
  pin: string;        // كود النافذة الحالية (المعروض على الشاشة)
  prevPin: string;    // كود النافذة اللي فاتت (لسه مقبول — سماح الكتابة)
  windowEndsAt: number; // إيه آخر لحظة الكود الحالي هيفضل صالح (epoch ms)
};

/** الكود الحالي للعرض على شاشة الحصة (بيستدعى من slot — يظهر جنب الـ QR) */
export function currentRoomPin(sessionId: string): RoomPinInfo {
  const idx = Math.floor(Date.now() / ROOM_PIN_WINDOW_MS);
  return {
    pin: pinForWindow(sessionId, idx),
    prevPin: pinForWindow(sessionId, idx - 1),
    windowEndsAt: (idx + 1) * ROOM_PIN_WINDOW_MS,
  };
}

/** تحقق كود القاعة — يقبل النافذة الحالية + اللي قبلها (constant-time-ish) */
export function verifyRoomPin(sessionId: string, pin: string): boolean {
  const clean = pin.replace(/\D/g, "");
  if (clean.length !== 4) return false;
  const { pin: cur, prevPin: prev } = currentRoomPin(sessionId);
  // مقارنة بثبات الزمن (توكن قصير — الحماية دي شكلية بس بنلتزم بيها)
  let okCur = 0, okPrev = 0;
  for (let i = 0; i < 4; i++) {
    okCur |= clean.charCodeAt(i) ^ cur.charCodeAt(i);
    okPrev |= clean.charCodeAt(i) ^ prev.charCodeAt(i);
  }
  return okCur === 0 || okPrev === 0;
}
