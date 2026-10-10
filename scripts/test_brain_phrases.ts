/* فحص سريع منطقي للدماغ الحتمي — صيغ تسجيل الحضور البديلة (spec P2) */
import { fallbackPlan } from "../src/ai/orchestrator/fallback.ts";

const ctx = {
  user: { id: "u", name: "مدير", role: "MANAGER", centerId: "c", permissions: [] },
  centerId: "c",
  view: "today",
} as unknown as Parameters<typeof fallbackPlan>[1];

const cases: Array<[string, string | null, boolean?]> = [
  ["سجل حضور أحمد", "أحمد"],
  ["سجل حضور أحمد ومحمد في حصة رياضيات", "أحمد ومحمد"],
  ["خلي أحمد حاضر", "أحمد"],
  ["أحمد جه النهارده، سجله", "أحمد"],
  ["بص يا زكي، أحمد موجود، ظبط حضوره", "أحمد"],
  ["Mark Ahmed as present", "ahmed"],
  ["خلي الكل حاضر", null, true], // الكل → markRest (مش اسم)
  ["الحضور: أحمد، محمد — الغايبين عمر وسالم سجل الباقي", "أحمد، محمد", true], // أسماء + تحضير معكوس معًا
];

let pass = 0, fail = 0;
for (const [text, want, wantRest] of cases) {
  const plan = fallbackPlan(text, ctx, []);
  const tool = plan?.tool?.name;
  if (tool !== "attendance.mark_names") {
    fail++;
    console.log(`❌ "${text}" → tool=${tool} (المفروض mark_names)`);
    continue;
  }
  const args = plan?.tool?.args as { namesText?: string; markRest?: boolean };
  const names = args?.namesText ?? null;
  const rest = !!args?.markRest;
  if (want === null) {
    if (rest && !names) { pass++; console.log(`✅ "${text}" → markRest (بدون أسماء)`); }
    else { fail++; console.log(`❌ "${text}" → names=${names} rest=${rest}`); }
  } else if ((rest === !!wantRest) && names && norm(names) === norm(want)) {
    pass++; console.log(`✅ "${text}" → «${names}»${rest ? " + markRest" : ""}`);
  } else {
    fail++; console.log(`❌ "${text}" → names="${names}" (المفروض "${want}") rest=${rest}`);
  }
}
console.log(`\n${pass}/${pass + fail} passed`);

function norm(t: string): string {
  return t.replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim().toLowerCase();
}
