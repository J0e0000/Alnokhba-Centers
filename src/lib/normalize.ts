// Arabic-Indic digit normalization, phone/code validation, money helpers.
// Shared by server APIs (and mirrored client-side for input UX).

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** Normalize Arabic-Indic / Persian digits to English digits. ٥٨٣٢١ → 58321 */
export function normalizeDigits(input: string): string {
  if (!input) return "";
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

/** Strip spaces, dashes, parentheses and Arabic tatweel/RTL marks from a raw string */
export function cleanRaw(input: string): string {
  return normalizeDigits(String(input ?? ""))
    .replace(/[\s\-()ـ\u200f\u200e\u202a-\u202e]/g, "");
}

export type PhoneCheck =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

/**
 * Egyptian mobile validation with clear Egyptian-Arabic errors.
 * Accepts: 010/011/012/015 + 8 digits (11 total), with optional +20 / 0020 prefix.
 */
export function validateEgyptianPhone(raw: string, isParent = false): PhoneCheck {
  const who = isParent ? "رقم موبايل ولي الأمر" : "رقم موبايل الطالب";
  if (!raw || !raw.trim()) return { ok: false, error: `${who} مطلوب.` };
  let n = cleanRaw(raw);
  // international prefixes: +20 / 0020 / 20 → restore the national leading zero
  if (n.startsWith("0020")) n = "0" + n.slice(4);
  else if (n.startsWith("+20")) n = "0" + n.slice(3);
  else if (n.startsWith("20") && n.length === 12) n = "0" + n.slice(2);
  if (!/^\d+$/.test(n)) {
    return { ok: false, error: `${who} فيه حروف غريبة — اكتب أرقام بس من فضلك.` };
  }
  if (n.length < 11) {
    return { ok: false, error: `${who} ناقص — المفروض 11 رقم، اللي كتبته ${n.length} رقم بس.` };
  }
  if (n.length > 11) {
    return { ok: false, error: `${who} زيادة — المفروض 11 رقم، اللي كتبته ${n.length} رقم.` };
  }
  if (!/^01[0125]\d{8}$/.test(n)) {
    return { ok: false, error: `${who} مش صح — لازم يبدأ بـ 010 أو 011 أو 012 أو 015.` };
  }
  return { ok: true, normalized: n };
}

/** Optional phone: empty is fine, invalid is rejected with explanation */
export function validateOptionalPhone(raw: string | null | undefined, label: string): PhoneCheck {
  if (!raw || !String(raw).trim()) return { ok: true, normalized: "" };
  const check = validateEgyptianPhone(String(raw));
  if (!check.ok) {
    return {
      ok: false,
      error: check.error.replace("رقم موبايل الطالب", label).replace("رقم موبايل ولي الأمر", label),
    };
  }
  return check;
}

export type CodeCheck =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

/** 5-digit student code validation with Egyptian-Arabic errors */
export function validateStudentCode(raw: string): CodeCheck {
  const n = cleanRaw(raw);
  if (!n) return { ok: false, error: "كود الطالب مطلوب — 5 أرقام." };
  if (!/^\d+$/.test(n)) return { ok: false, error: "كود الطالب لازم يكون أرقام بس." };
  if (n.length !== 5) {
    return { ok: false, error: `كود الطالب لازم يكون 5 أرقام بالظبط — اللي كتبته ${n.length} رقم.` };
  }
  return { ok: true, normalized: n };
}

// ============================= MONEY =============================
// All storage is integer piastres. EGP floats only exist at the API boundary.

export function toPiastres(egp: number | string): number {
  const n = typeof egp === "string" ? parseFloat(normalizeDigits(egp).replace(/,/g, "")) : egp;
  if (!isFinite(n)) throw new Error("المبلغ اللي كتبته مش رقم صحيح.");
  const p = Math.round(n * 100);
  if (Math.abs(p) > 2_000_000_000) throw new Error("المبلغ ده كبير بشكل غير منطقي — راجعه تاني.");
  return p;
}

export function toEGP(piastres: number | null | undefined): number {
  return Math.round((piastres ?? 0)) / 100;
}

export function formatEGP(piastres: number | null | undefined): string {
  const egp = toEGP(piastres);
  const s = egp % 1 === 0 ? egp.toLocaleString("en-EG") : egp.toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} جنيه`;
}

// ============================= DATES =============================

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function dayNameAR(dow: number): string { return DAY_NAMES[((dow % 7) + 7) % 7]; }
export function monthNameAR(month1to12: number): string { return MONTH_NAMES[month1to12 - 1] ?? ""; }

/** YYYY-MM-DD in Africa/Cairo local time (DST-safe via Intl) */
export function todayStr(now = new Date()): string {
  // en-CA gives YYYY-MM-DD; timeZone handles Cairo DST (UTC+2/+3) correctly
  return cairoDateStr(now);
}

/** YYYY-MM-DD of ANY Date in Africa/Cairo local time — use for grouping/filtering
 *  ledger timestamps so early-morning (00:00–03:00) transactions land on the
 *  correct Cairo day instead of the UTC "yesterday". */
export function cairoDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** HH:MM الحالي بتوقيت القاهرة (DST-safe) — للمقارنة بأوقات الحصص على السيرفر */
export function nowHM(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/** UTC offset of Africa/Cairo at the given instant, in minutes (+120 or +180). */
function cairoOffsetMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return Math.round((asUTC - d.getTime()) / 60000);
}

/** حدود يوم كامل بتوقيت القاهرة كساعات UTC دقيقة (بيتعامل مع DST).
 *  startOf("2026-08-31") = لحظة نص ليل 31 أغسطس بتوقيت القاهرة. */
export function cairoDayBounds(date: string): { start: Date; end: Date } {
  const noonUTC = new Date(`${date}T12:00:00.000Z`);
  const offset = cairoOffsetMinutes(noonUTC);
  let start = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - offset * 60000);
  // DST safety: لو الحدود طلعت غلط بساعة (تغيير التوقيت في نص الليل) صحّحها
  if (cairoDateStr(start) !== date) start = new Date(start.getTime() + 3600 * 1000);
  const end = new Date(start.getTime() + 24 * 3600 * 1000 - 1);
  return { start, end };
}

export function formatTime12(t: string): string {
  // "17:00" → "5:00 م"
  const [hStr, m] = (t ?? "").split(":");
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return t;
  const suffix = h >= 12 ? "م" : "ص";
  h = h % 12 || 12;
  return `${h}:${m ?? "00"} ${suffix}`;
}

export function formatDateAR(dateStr: string): string {
  // "2026-08-25" → "25 أغسطس 2026"
  const [y, m, d] = (dateStr ?? "").split("-").map(Number);
  if (!y || !m || !d) return dateStr ?? "";
  return `${d} ${monthNameAR(m)} ${y}`;
}
