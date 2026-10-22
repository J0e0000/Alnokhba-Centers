// ============================================================
// تحويل أرقام الواتساب لصيغة wa.me الدولية الصحيحة — مصدر واحد مشترك
// (كانت المنطق منسوخ في wa.ts و messages.ts ونسخة واحدة منهم فيها
//  "2" بدل "20" → واتساب يرفض الرقم «مفقود كود الدولة» — bug 2026-10-22)
//
// القاعدة المصرية: المحلي 01XXXXXXXXX (11 رقم) → الدولي 20 1XXXXXXXXX (12 رقم)
// wa.me محتاج الرقم الدولي من غير + ولا صفر في الأول.
// الدالة دي pure ومفيهاش أي imports — تتستورد من الواجهة والسيرفر والاختبارات بالظبط.
// ============================================================

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const pi = PERSIAN.indexOf(ch);
    if (pi >= 0) { out += String(pi); continue; }
    out += ch;
  }
  return out;
}

/**
 * أي صيغة رقم مصري → الرقم الدولي لـ wa.me (مثال: 01014996636 → 201014996636).
 * بيقبل: محلي 01x · دولي 201x · 0020 1x · +20 1x · أرقام عربية/فارسية · مسافات وشرطات.
 * بيرجّع null لو مفيش رقم خالص. الأرقام الأجنبية (مش مصر) بتعدّ زي ما هي بعد التنضيف.
 */
export function toWaNumber(phone: string): string | null {
  let p = normalizeDigits(String(phone ?? "")).replace(/\D/g, "");
  if (!p) return null;
  // 1) وحّد على الصيغة المحلية 0XXXXXXXXX
  if (p.startsWith("0020")) p = "0" + p.slice(4);
  else if (p.startsWith("20") && p.length === 12) p = "0" + p.slice(2);
  // 2) الصفر اتنسخ بالغلط (10 أرقام بتبدأ بـ 1) → رجّعه
  if (!p.startsWith("0") && p.length === 10 && p.startsWith("1")) p = "0" + p;
  // 3) محلي → دولي: كود مصر 20 (مش 2!) — ده كان البق
  if (p.startsWith("0")) p = "20" + p.slice(1);
  return p;
}
