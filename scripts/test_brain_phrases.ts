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
if (fail > 0) process.exit(1);

/* ============================================================
   إحالة الضمير (spec: سياق المحادثة) — «سجل حضوره» بلا اسم:
   الشاشة ← آخر طالب (ذاكرة محادثة) ← نتيجة بحث وحيدة في المهمة.
   مفيش إحالة = سؤال صريح (ممنوع تخمين). ملاحظة: الدماغ الحتمي
   بيرجّع الإحالة لما يكون الطلب قصير (≤ 6 كلمات) أو من غير موديل —
   هنا بنتست الدماغ مباشرة فالعقد هو المهم.
============================================================ */

type Ctx = Parameters<typeof fallbackPlan>[1];

const screenCtx = {
  ...ctx,
  selectedStudent: { id: "s_screen", name: "أحمد سعيد", code: "99001" },
} as unknown as Ctx;
const memCtx = {
  ...ctx,
  lastStudent: { id: "s_mem", name: "سارة محمود", code: "99002" },
} as unknown as Ctx;
const emptyCtx = { ...ctx } as unknown as Ctx;
const searchObs = [
  { tool: "student.search", summary: "نتيجة واحدة", data: { q: "منة", students: [{ id: "s_obs", name: "منة الله", code: "99003" }] } },
];
// بحث بنتيجة متعددة — ممنوع نرجع لأي حد منهم
const multiObs = [
  { tool: "student.search", summary: "نتايج متعددة", data: { q: "أحمد", students: [{ id: "a", name: "أحمد واحد", code: "1" }, { id: "b", name: "أحمد اتنين", code: "2" }] } },
];

type PronCase = {
  label: string;
  text: string;
  ctx: Ctx;
  obs?: typeof searchObs;
  expect: { kind: "tool"; tool: string; namesText?: string; studentId?: string } | { kind: "need_info" } | { kind: "none" };
};

const pronounCases: PronCase[] = [
  { label: "ضمير + طالب مفتوح على الشاشة", text: "سجل حضوره", ctx: screenCtx, expect: { kind: "tool", tool: "attendance.mark_names", namesText: "أحمد سعيد" } },
  { label: "ضمير + ذاكرة محادثة (مهمة جديدة)", text: "سجل حضوره", ctx: memCtx, expect: { kind: "tool", tool: "attendance.mark_names", namesText: "سارة محمود" } },
  { label: "«ظبط حضوره» + ذاكرة", text: "ظبط حضوره", ctx: memCtx, expect: { kind: "tool", tool: "attendance.mark_names", namesText: "سارة محمود" } },
  { label: "ضمير + حصة محددة", text: "سجل حضوره في حصة رياضيات", ctx: memCtx, expect: { kind: "tool", tool: "attendance.mark_names", namesText: "سارة محمود" } },
  { label: "ضمير + نتيجة بحث وحيدة في نفس المهمة", text: "سجل حضوره", ctx: emptyCtx, obs: searchObs, expect: { kind: "tool", tool: "attendance.mark_names", namesText: "منة الله" } },
  { label: "«سجل حضور»bare + ذاكرة", text: "سجل حضور", ctx: memCtx, expect: { kind: "tool", tool: "attendance.mark_names", namesText: "سارة محمود" } },
  { label: "ضمير + مفيش أي إحالة → سؤال (ممنوع تخمين)", text: "سجل حضوره", ctx: emptyCtx, expect: { kind: "need_info" } },
  { label: "ضمير + بحث متعدد النتايج → سؤال (ممنوع تخمين)", text: "سجل حضوره", ctx: emptyCtx, obs: multiObs, expect: { kind: "need_info" } },
  { label: "«تقريره» + ذاكرة", text: "تقريره", ctx: memCtx, expect: { kind: "tool", tool: "reports.get_student_report", studentId: "s_mem" } },
  { label: "«تقريره» + طالب الشاشة يكسب الذاكرة", text: "تقريره", ctx: screenCtx, expect: { kind: "tool", tool: "reports.get_student_report", studentId: "s_screen" } },
  { label: "«سجل دفعته» + ذاكرة → بحث بالاسم", text: "سجل دفعته 50 جنيه", ctx: memCtx, expect: { kind: "tool", tool: "student.search", namesText: "سارة محمود" } },
  // انحدارات استخراج اسم الدفعة — «ل» الجديدة لازم تفضل شغالة صح
  { label: "دفعة بالاسم «لأحمد محمد»", text: "سجل دفعة 50 جنيه لأحمد محمد", ctx: emptyCtx, expect: { kind: "tool", tool: "student.search", namesText: "أحمد محمد" } },
  { label: "دفعة «لحساب سارة»", text: "سجل دفعة 50 جنيه لحساب سارة", ctx: emptyCtx, expect: { kind: "tool", tool: "student.search", namesText: "سارة" } },
  { label: "«دفعته» bare + ذاكرة", text: "دفعته 50 جنيه", ctx: memCtx, expect: { kind: "tool", tool: "student.search", namesText: "سارة محمود" } },
];

let pPass = 0, pFail = 0;
for (const c of pronounCases) {
  const plan = fallbackPlan(c.text, c.ctx, c.obs ?? []);
  let verdict: string;
  let passNow = false;
  if (!plan) {
    verdict = "null";
    passNow = c.expect.kind === "none";
  } else if (plan.need_info) {
    verdict = `need_info «${plan.need_info.question}»`;
    passNow = c.expect.kind === "need_info";
  } else if (plan.tool) {
    const args = plan.tool.args as Record<string, unknown>;
    verdict = `${plan.tool.name} ${JSON.stringify(args)}`;
    if (c.expect.kind === "tool" && plan.tool.name === c.expect.tool) {
      if (c.expect.namesText != null) {
        // الحضور بيتحسم بـ namesText — والدفع/التسجيل بيتحسم بـ q (بحث بالاسم)
        const val = plan.tool.name === "student.search" ? String(args.q ?? "") : String(args.namesText ?? "");
        passNow = norm(val) === norm(c.expect.namesText);
      }
      else if (c.expect.studentId != null) passNow = args.studentId === c.expect.studentId;
      else passNow = true;
      // التأكيد إجباري على الكتابة — الإحالة ما بتتجاوزش سياسة التأكيد
      if (passNow && plan.tool.name === "attendance.mark_names") {
        passNow = /تأكيد/u.test(plan.say);
      }
    }
  } else {
    verdict = `say: ${plan.say.slice(0, 60)}`;
  }
  if (passNow) { pPass++; console.log(`✅ [إحالة] ${c.label} → ${verdict.slice(0, 90)}`); }
  else { pFail++; console.log(`❌ [إحالة] ${c.label} → ${verdict.slice(0, 140)}`); }
}
console.log(`\nإحالة الضمير: ${pPass}/${pPass + pFail} passed`);
if (pFail > 0) process.exit(1);

function norm(t: string): string {
  return t.replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim().toLowerCase();
}
