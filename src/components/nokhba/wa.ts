"use client";

/* ============================================================
   WhatsApp handoff — فتح محادثة wa.me بطريقة تعمل على كل المتصفحات.
   المشكلة المعروفة على iPhone/Safari: أي window.open بعد طلب async
   بيحسبه المتصفح popup مش مستخدم-initiated ويقفله.
   الحل: على iOS نعمل تنقل في نفس التاب (window.location.href) —
   ومضمون إنه يفتح تطبيق واتساب. على الديسكتوب popup عادي.
============================================================ */

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ipadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || ipadOS;
}

/**
 * يفتح رابط wa.me بأفضل طريقة للمتصفح الحالي.
 * يرجّع true لو الافتتاح اتطلب فعلاً (location.href أو popup اتفتح).
 * يرجّع false لو الـ popup اتقفل من المتصفح — الواجهة تعرض fallback النسخ.
 */
export function openWhatsAppHandoff(waUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (isIOS()) {
    // نفس التاب — مفيش popup blocker في الطريق
    window.location.href = waUrl;
    return true;
  }
  const w = window.open(waUrl, "_blank", "noopener,noreferrer");
  return !!w;
}

/**
 * تحويل رقم مصري محلي (01xxxxxxxxx) لصيغة wa.me الدولية (20xxxxxxxxx)
 * + تجهيز اللينك برسالة عربية مترمّزة صح.
 */
export function buildWaUrl(phone: string, message: string): string {
  let p = (phone ?? "").replace(/\D/g, "");
  if (p.startsWith("0020")) p = "0" + p.slice(4);
  else if (p.startsWith("+20")) p = "0" + p.slice(3);
  else if (p.startsWith("20") && p.length === 12) p = "0" + p.slice(2);
  if (p.startsWith("0")) p = "2" + p.slice(1); // 01x → 201x
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}
