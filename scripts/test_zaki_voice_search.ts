/* ============================================================
   Unit checks: Arabic name matching + speech text preparation.
   Run: npx tsx scripts/test_zaki_voice_search.ts
============================================================ */
import { normalizeAr, nameMatchScore } from "../src/lib/arabic";
import { prepareSpeechText, numberToArabicWords } from "../src/lib/speech-text";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: string) => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${extra ? ` — ${extra}` : ""}`); }
};

/* ---------- تطبيع الاسماء والمطابقة ---------- */
ok("normalize: احمد == أحمد", normalizeAr("احمد") === normalizeAr("أحمد"));
ok("normalize: مريمه == مريمـة", normalizeAr("مريمه") === normalizeAr("مريمـة"));
ok("normalize: على == علي", normalizeAr("على") === normalizeAr("علي"));
ok("normalize: تشكيل مقصوص", normalizeAr("مُحمَّد") === normalizeAr("محمد"));
ok("normalize: أرقام عربية", normalizeAr("كود ١٠٠١٢") === normalizeAr("كود 10012"));

ok("match: احمد يلاقي أحمد محمد ببادئة (90)", nameMatchScore("احمد", "أحمد محمد") === 90);
ok("match: احمد يلاقي أحمد سامي علي ببادئة (90)", nameMatchScore("احمد", "أحمد سامي علي") === 90);
ok("match: احمد سامي يلاقي أحمد محمود سامي (token)", nameMatchScore("احمد سامي", "أحمد محمود سامي") >= 60);
ok("match: مريم على يلاقي مريم علي", nameMatchScore("مريم على", "مريم علي") >= 60);
ok("match: كود نصي", nameMatchScore("10012", "10012") === 100);
ok("match: مفيش مطابقة", nameMatchScore("شريف", "أحمد محمد") === 0);

/* ---------- تحضير النص الصوتي ---------- */
const cases: [string, string, string][] = [
  ["فلوس ج", "سجلت دفعة 50 ج", "خمسون جنيه"],
  ["فلوس جنيه", "رصيده 250 جنيه عليه", "مئتان وخمسون جنيه"],
  ["فلوس معلقة", "50 ج سجلتها", "خمسون جنيه"],
  ["وقت", "الحصة 17:00–18:30", "الخامسة مساءً"],
  ["وقت ونص", "17:30", "الخامسة والنصف مساءً"],
  ["وقت ربع", "08:15", "الثامنة والربع صباحًا"],
  ["تاريخ", "التجديد 2026-10-19 باقي", "التاسع عشر من أكتوبر"],
  ["كود", "كود 10012", "واحد صفر صفر واحد اثنان"],
  ["موبايل", "01012345678", "صفر واحد صفر"],
  ["نسبة", "حضوره 85%", "خمسة وثمانون بالمئة"],
  ["عدد", "عندك 19 طالب", "تسعة عشر طالب"],
  ["ألف", "حصّلنا 15000 النهارده", "خمسة عشر ألف"],
];
for (const [name, input, expect] of cases) {
  const out = prepareSpeechText(input);
  ok(`speech: ${name}`, out.includes(expect), `out="${out}" expected to include "${expect}"`);
}
ok("speech: خالي من الأرقام بعد التحضير", !/\d/.test(prepareSpeechText("سجلت 50 ج على 17:00 كود 10012 حضور 85%")));
ok("speech: idempotent", prepareSpeechText(prepareSpeechText("دفعة 50 ج الساعة 17:00 يوم 2026-10-19")) === prepareSpeechText("دفعة 50 ج الساعة 17:00 يوم 2026-10-19"));
ok("number: 2026", numberToArabicWords(2026) === "ألفان وستة وعشرون", numberToArabicWords(2026));
ok("number: 150", numberToArabicWords(150) === "مئة وخمسون", numberToArabicWords(150));
ok("number: 12.5", numberToArabicWords(12.5).includes("فاصل"), numberToArabicWords(12.5));
ok("number: 30000", numberToArabicWords(30000) === "ثلاثون ألف", numberToArabicWords(30000));
ok("number: 0", numberToArabicWords(0) === "صفر");

console.log(`\n===== ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
