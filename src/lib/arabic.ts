/* ============================================================
   Arabic text normalization + fuzzy name matching.
   WHY: Prisma `contains` matches raw strings — «احمد» (bare alif)
   does NOT match «أحمد» (hamza), «مريم» vs «مريمه», «على» vs «علي».
   Center staff type names without hamzas/diacritics all the time,
   which made student search return 0 results → the agent retried
   variants → burned its iteration budget → the "loop" users saw.
   Fix: score matching in memory against normalized forms.
   Shared by: agent student tools (search/resolve), runner loop guards.
============================================================ */

/** حروف التشكيل والتطويل والعلامات القرآنية */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/**
 * تطبيع عربي قياسي: تشكيل زرو، همزات موحدة (أإآٱ→ا)، تاء مربوطة→ه،
 * ألف مقصورة→ي، ؤ→و، ئ→ي، أرقام عربية→إنجليزي، ترميز من غير حروف/أرقام، مسافات نظيفة.
 */
export function normalizeAr(input: string): string {
  if (!input) return "";
  let out = "";
  for (const ch of input) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const pi = PERSIAN.indexOf(ch);
    if (pi >= 0) { out += String(pi); continue; }
    out += ch;
  }
  return out
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type NameMatch = { score: number; exact: boolean };

/**
 * تقييم مطابقة «استفسار» ضد اسم/كود/تليفون.
 * - تطابق كامل بعد التطبيع = 100
 * - بادئة (الاسم بيبدأ بالاستفسار) = 90
 * - الاحتواء (الاسم فيه الاستفسار كنص) = 80
 * - كل كلمات الاستفسار موجودة في كلمات الاسم = 60 (+10 لكل كلمة متطابقة حرفيًا)
 * - مطابقة كود/تليفون كاملة = 95
 * أقل من كده = مفيش مطابقة (0).
 */
export function nameMatchScore(query: string, target: string): number {
  const nq = normalizeAr(query);
  const nt = normalizeAr(target);
  if (!nq || !nt) return 0;
  if (nq === nt) return 100;
  if (nt.startsWith(nq)) return 90;
  if (nt.includes(nq)) return 80;

  const qTokens = nq.split(" ").filter(Boolean);
  const tTokens = nt.split(" ").filter(Boolean);
  if (!qTokens.length || !tTokens.length) return 0;

  // كل كلمة من الاستفسار لازم تلاقي مكانها في كلمة من الاسم
  let exactHits = 0;
  for (const qt of qTokens) {
    const hit = tTokens.some((tt) => tt === qt)
      ? "exact"
      : qt.length >= 3 && tTokens.some((tt) => tt.startsWith(qt))
        ? "prefix"
        : null;
    if (!hit) return 0;
    if (hit === "exact") exactHits++;
  }
  return 60 + Math.min(exactHits, 4) * 10;
}

/** أفضل نتيجة على مجموعة مرشحين — بيرجع الدرجة والاندكس عشان نعمل sort بسرعة */
export function bestMatchScore(query: string, targets: { name: string; code?: string; phone?: string | null }[]): number {
  let best = 0;
  for (const t of targets) {
    const s = Math.max(
      nameMatchScore(query, t.name),
      t.code ? nameMatchScore(query, t.code) : 0,
      t.phone ? nameMatchScore(query, t.phone) : 0,
    );
    if (s > best) best = s;
    if (best === 100) break;
  }
  return best;
}
