/* فحص سريع لتسجيل الأرقام الذكي — كل الصيغ اللي المالك ممكن يكتبها/يلصقها */
import { smartPhoneDigits, formatPhoneIntl, validateEgyptianPhone } from "../src/lib/normalize";

const cases: [string, string][] = [
  ["01012345678", "01012345678"],           // عادي
  ["+201012345678", "01012345678"],         // دولي بلس
  ["00201012345678", "01012345678"],        // 00 international
  ["201012345678", "01012345678"],          // 20 بدون علامة
  ["+20 101 234 5678", "01012345678"],      // دولي بمسافات
  ["٠١٠١٢٣٤٥٦٧٨", "01012345678"],           // أرقام عربية
  ["0101-234-5678", "01012345678"],         // شرط
  ["(010) 1234 5678", "01012345678"],       // أقواس
  ["+2 01012345678", "01012345678"],        // +2 منفصلة (زي ما بتظهر في الحقل)
  ["0101234567", "0101234567"],             // ناقص أثناء الكتابة — مش بيتمسح
  ["+20", "0"],                             // أثناء كتابة +20 حرف حرف
  ["", ""],                                 // فاضي
  ["01O12345678", "0112345678"],            // حرف O وسط الرقم → بيتشال هو مش الأرقام
];

let fail = 0;
for (const [raw, want] of cases) {
  const got = smartPhoneDigits(raw);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${raw}" → "${got}" (expected "${want}")`);
}

// عرض دولي
console.log(formatPhoneIntl("01012345678") === "+2 01012345678" ? "PASS" : "FAIL", " formatPhoneIntl →", formatPhoneIntl("01012345678"));

// فحصات السيرفر: الصيغ الدولية كلها بتقبل
const sv: [string, boolean][] = [
  ["01012345678", true],
  ["+201012345678", true],
  ["00201012345678", true],
  ["201012345678", true],
  ["1012345678", true],   // ناسي الصفر — بيتكمل لوحده
  ["0101234567", false],  // 10 أرقام غلط
  ["02012345678", false], // مابتديش بـ 01x
];
for (const [raw, wantOk] of sv) {
  const r = validateEgyptianPhone(raw);
  const ok = r.ok === wantOk;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  validate("${raw}") → ${r.ok ? r.normalized : r.error}`);
}

process.exit(fail ? 1 : 0);
