/* ============================================================
   Speech text preparation — makes Arabic TTS sound like a human.
   Raw agent replies contain digits, times, dates, codes, %, currency
   abbreviations («50 ج», «17:00», «2026-10-19», «كود 10012», «85%»)
   — TTS engines (Arabic voices included) mangle those or read them
   in English. This converts everything to Arabic words BEFORE the
   voice engine, and is IDEMPOTENT (running twice = same result),
   so client and server can both apply it safely.

   Applies to: /api/agent/speak (server) + browser speechSynthesis
   fallback (client) — same text, same pronunciation.
============================================================ */

const ONES = ["صفر", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** ساعة بالعربي — أسماء الساعات المؤنثة (الواحدة…الثانية عشرة) */
const HOUR_F = ["الواحدة", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة", "الحادية عشرة", "الثانية عشرة"];

/** أسماء الأرقام حرف حرف — للأكواد وأرقام الموبايل والمعرفات الطويلة */
function digitWords(digits: string): string {
  return digits.split("").map((d) => ONES[Number(d)] ?? d).join(" ");
}

/** تحويل رقم (0 → 999,999,999 مع كسور) لكلمات عربية فصيحة — قراءة طبيعية للصوت */
export function numberToArabicWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (!Number.isInteger(n)) {
    const [i, f] = String(n).split(".");
    return `${numberToArabicWords(Number(i))} فاصل ${digitWords(f)}`;
  }
  const neg = n < 0 ? "سالب " : "";
  n = Math.abs(Math.floor(n));
  if (n < 10) return neg + ONES[n];
  if (n === 10) return neg + "عشرة";
  if (n === 11) return neg + "أحد عشر";
  if (n === 12) return neg + "اثنا عشر";
  if (n < 20) return neg + `${ONES[n - 10]} عشر`;
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return neg + (o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
  }
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const restM = n % 1_000_000;
  if (millions === 1) parts.push("مليون");
  else if (millions === 2) parts.push("مليونان");
  else if (millions > 0 && millions <= 10) parts.push(`${numberToArabicWords(millions)} ملايين`);
  else if (millions > 0) parts.push(`${numberToArabicWords(millions)} مليون`);
  const thousands = Math.floor(restM / 1000);
  const restT = restM % 1000;
  if (thousands === 1) parts.push("ألف");
  else if (thousands === 2) parts.push("ألفان");
  else if (thousands > 0 && thousands <= 10) parts.push(`${numberToArabicWords(thousands)} آلاف`);
  else if (thousands > 0) parts.push(`${numberToArabicWords(thousands)} ألف`);
  if (restT > 0) {
    const hundreds = Math.floor(restT / 100);
    const restH = restT % 100;
    if (hundreds === 1) parts.push("مئة");
    else if (hundreds === 2) parts.push("مئتان");
    else if (hundreds > 0) parts.push(`${ONES[hundreds]} مئة`);
    if (restH > 0) parts.push(numberToArabicWords(restH));
  }
  return neg + parts.join(" و");
}

/** العدد الترتيبي 1-31 — لأسماء الأيام في التواريخ */
function ordinalArabic(n: number): string {
  const ordOne = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"];
  if (n <= 9) return ordOne[n];
  if (n === 10) return "العاشر";
  if (n === 11) return "الحادي عشر";
  if (n === 12) return "الثاني عشر";
  if (n < 20) return `${ordOne[n - 10] ?? ONES[n - 10]} عشر`;
  const t = Math.floor(n / 10), o = n % 10;
  const tenOrd = ["", "", "العشرون", "الثلاثون", "الأربعون", "الخمسون", "الستون", "السبعون", "الثمانون", "التسعون"];
  return o ? `${ordOne[o] ?? ONES[o]} و${tenOrd[t]}` : tenOrd[t];
}

/** الساعة HH:MM بالعربي — «الخامسة والنصف مساءً» / «السادسة إلا ربع صباحًا» */
function timeToArabic(h24: number, m: number): string {
  const period = h24 < 12 ? "صباحًا" : "مساءً";
  let h12 = h24 % 12;
  let prefix = "";
  if (m === 45) { h12 = (h12 + 1) % 12; prefix = "إلا ربع"; }
  else if (m === 30) prefix = "والنصف";
  else if (m === 15) prefix = "والربع";
  if (h12 === 0) h12 = 12; // الساعة 12 (ظهرًا/منتصف الليل)
  const hour = HOUR_F[h12 - 1] ?? String(h12);
  if (m === 0) return `${hour} ${period}`;
  if (prefix) return `${hour} ${prefix} ${period}`;
  const unit = m === 1 ? "ودقيقة" : m === 2 ? "ودقيقتين" : m <= 10 ? `و${numberToArabicWords(m)} دقائق` : `و${numberToArabicWords(m)} دقيقة`;
  return `${hour} ${unit} ${period}`;
}

function normalizeDigitsToAscii(s: string): string {
  let out = "";
  for (const ch of s) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const pi = PERSIAN.indexOf(ch);
    if (pi >= 0) { out += String(pi); continue; }
    out += ch;
  }
  return out;
}

/** رقم عشري «12.5» → «اثنا عشر فاصل خمسة» */
function decimalToWords(raw: string): string {
  const [intPart, fracPart] = raw.split(/[.٫]/);
  const frac = digitWords(fracPart.replace(/0+$/, "") || "صفر");
  return `${numberToArabicWords(Number(intPart))} فاصل ${frac}`;
}

/**
 * تحضير النص للنطق — idempotent: مرة واحدة كفاية، ولو اتنادت تاني مفيش تغيير.
 * الترتيب مقصود: تواريخ ← ساعات ← نسبة مئوية ← فلوس ← موبايلات ← أكواد ← أرقام عامة.
 */
export function prepareSpeechText(input: string): string {
  let t = String(input ?? "")
    // تنظيف أولي: ماركداون وإيموجي وعلامات اتجاه
    .replace(/[*_#`>•|]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u200F\u200E\u202A-\u202E]/gu, " ")
    .normalize("NFC");
  t = normalizeDigitsToAscii(t);

  // التواريخ ISO — قبل الساعات والأرقام
  t = t.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_m, y, mo, d) => {
    const mi = Number(mo), di = Number(d);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return _m;
    const year = Number(y);
    const yearWords = year <= 9999 ? numberToArabicWords(year) : digitWords(y);
    return `${ordinalArabic(di)} من ${MONTHS[mi - 1]} ${yearWords}`;
  });

  // الساعات HH:MM — «الساعة 17:00» و«17:00–18:30»
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mm) => {
    const h24 = Number(h), mi = Number(mm);
    if (h24 > 23 || mi > 59) return m;
    return timeToArabic(h24, mi);
  });

  // النسب: «85%» / «85 ٪» → «خمسة وثمانون بالمئة»
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:%|٪)/g, (_m, num) => {
    const v = Number(String(num).replace(",", "."));
    return Number.isFinite(v) ? `${numberToArabicWords(v)} بالمئة` : _m;
  });

  // الفلوس: «50 ج» / «50جنيه» / «150 جنيهًا» / «50 EGP» → «خمسون جنيه»
  // الـ lookahead بيمنع نطابق «ج» أول كلمة تانية (زي «جمعة») — بس مش بيمنع التشكيل بعد الكلمة
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:جنيها?|ج\s?\.?\s?م|ج)(?![\u0621-\u064Aa-zA-Z0-9])/g, (_m, num) => {
    const v = Number(String(num).replace(",", "."));
    return Number.isFinite(v) && v < 100_000_000 ? `${numberToArabicWords(v)} جنيه` : _m;
  });
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:egp|جنيه مصرى)/gi, (_m, num) => {
    const v = Number(String(num).replace(",", "."));
    return Number.isFinite(v) && v < 100_000_000 ? `${numberToArabicWords(v)} جنيه` : _m;
  });

  // العشري — قبل الأرقام الصحيحة العامة
  t = t.replace(/\b\d{1,9}[.٫]\d{1,4}\b/g, (m) => decimalToWords(m));

  // الموبايلات (01xxxxxxxxx) والمعرفات الطويلة — حرف حرف
  t = t.replace(/\b0\d{9,10}\b/g, (m) => digitWords(m));
  t = t.replace(/\b\d{7,}\b/g, (m) => digitWords(m));

  // الأكواد — بس لما السياق يوضح كود: «كود 10012» أو بين أقواس «أحمد (10012)»
  // (صيغ رسائل الوكيل للتحديد بالكود). الأرقام البسيطة بدون سياق بتتقرأ كمبلغ/عدد عادي.
  t = t.replace(/((?:ال)?كود[\u0600-\u064A]{0,2}\s*)\((\d{1,6})\)/g, (_m, pre, code) => `${pre}${digitWords(code)}`);
  t = t.replace(/((?:ال)?كود[\u0600-\u064A]{0,2}\s*)(\d{4,6})/g, (_m, pre, code) => `${pre}${digitWords(code)}`);
  t = t.replace(/\((\d{4,6})\)/g, (_m, code) => ` ${digitWords(code)} `);

  // الأرقام المتبقية — كلمات
  t = t.replace(/\b\d{1,6}\b/g, (m) => {
    const v = Number(m);
    return Number.isFinite(v) ? numberToArabicWords(v) : m;
  });

  return t
    .replace(/\s+/g, " ")
    .replace(/\s+([،,.!؟?؛:])/g, "$1")
    .trim();
}
