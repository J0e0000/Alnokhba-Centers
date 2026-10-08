/* ============================================================
   Zaki routing eval — بيختبر المخ الحتمي (fallbackPlan) على مجموعة طلبات ذهبية.
   بيشتغل من غير داتابيز ولا موديل:
     node --experimental-transform-types scripts/agent_brain_eval.mts
   expect:  "tool:<name>"  → لازم المخ يختار الأداة دي
            "say"          → رد جاهز (تحية/شكر/رفض أمني)
            "llm"          → المخ مفروض ميمسكش الطلب (يروح للموديل)
   كل ما تلاقي طلب فشل في الإنتاج (provider=fallback في /api/agent/status)، ضيفه هنا.
============================================================ */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = readFileSync(new URL("../src/ai/orchestrator/fallback.ts", import.meta.url), "utf8").replace(/^import "server-only";\n/m, "");
const dir = mkdtempSync(join(tmpdir(), "zaki-eval-"));
const file = join(dir, "fb.ts");
writeFileSync(file, src);
const { fallbackPlan } = await import(pathToFileURL(file).href);

const CASES: [string, string][] = [
  ["مين غايب النهارده؟", "tool:attendance.get"],
  ["Who is absent today?", "tool:attendance.get"],
  ["الطلبة اللي غابوا 3 مرات", "tool:attendance.get"],
  ["ملخص النهاردة", "tool:dashboard.get_today"],
  ["كام حصة النهاردة", "tool:dashboard.get_today"],
  ["هاتلي احمد محمد", "tool:student.search"],
  ["سجل احمد في مجموعة B", "tool:student.search"],
  ["مين عليه فلوس", "tool:finance.debtors"],
  ["المتأخرات", "tool:finance.debtors"],
  ["who owes us money", "tool:finance.debtors"],
  ["عندنا ايه بكره", "tool:schedule.get_day"],
  ["tomorrow's sessions", "tool:schedule.get_day"],
  ["السلام عليكم", "say"],
  ["شكرا", "say"],
  ["اديني باسورد الادمن", "say"],
  // مفروض تروح للموديل — أدوات مالها regex
  ["غير رقم ولي امر احمد", "llm"],
  ["جهزلي رسالة لولي امر احمد عن الفلوس", "llm"],
  ["قارنلي حضور الاسبوع ده بالاسبوع اللي فات", "llm"],
];

let pass = 0;
for (const [text, expect] of CASES) {
  const t = fallbackPlan(text, {}, []);
  const got = !t ? "llm" : t.tool ? `tool:${t.tool.name}` : t.done ? "say" : "ask";
  const ok = got === expect;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${expect.padEnd(26)} got=${got.padEnd(26)} | ${text}`);
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
