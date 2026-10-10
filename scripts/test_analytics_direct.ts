/**
 * اختبار حتمي مباشر لأداة التحليل reports.analyze — من غير LLM
 * بيشغّل الـ handler الحقيقي على الداتابيز المحلية وبيتحقق من:
 *   1) الأرقام موجودة وصحيحة الشكل (مفيش NaN ولا قيم ناقصة)
 *   2) فترتي المقارنة محسوبين صح (الحالي واللي قبله)
 *   3) بوابة الصلاحيات: مدرس من غير VIEW_REPORTS → ممنوع
 *   4) حقن centerId من خارج السكيما بيتشال (zod strip)
 *   5) كارت التقرير جاهز للعرض
 * Run: set -a; source .env; set +a; NODE_OPTIONS=--conditions=react-server npx tsx scripts/test_analytics_direct.ts
 */
import "../src/ai/tools/analytics"; // تسجيل الأداة (import side-effect)
import { getTool, authorizeAndValidate } from "../src/ai/tools/registry";
import type { ToolContext } from "../src/ai/tools/types";

let pass = 0, fail = 0;
const ok = (m: string) => { pass++; console.log(`✅ ${m}`); };
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };

const CENTER = process.env.ANALYTICS_CENTER_ID ?? "cmufick570003iqo9fnqvrh2c";

function ctxFor(role: string, perms: string[]): ToolContext {
  return {
    user: { id: "test-user", role, permissions: perms, centerId: CENTER, name: "اختبار" } as never,
    centerId: CENTER,
    taskId: "direct-test",
  };
}

async function main() {
  const tool = getTool("reports.analyze");
  if (!tool) { bad("أداة reports.analyze متسجلة"); return; }
  ok("أداة reports.analyze متسجلة في الكتالوج");

  // ==== 1) أسبوع — مدير (صلاحيات كاملة) ====
  const mctx = ctxFor("MANAGER", ["VIEW_REPORTS", "VIEW_STUDENT_FINANCIAL_STATUS"]);
  const out = await tool.handler({ period: "week" }, mctx);
  if (out.summary && out.summary.length > 10) ok(`ملخص: ${out.summary.slice(0, 90)}…`);
  else bad("الملخص فاضي");

  const d = (out.data ?? {}) as Record<string, unknown>;
  const att = d.attendance as { current: { rate: number | null; total: number }; previousRate: number | null } | undefined;
  if (att && (att.current.rate === null || typeof att.current.rate === "number") && typeof att.current.total === "number") ok(`نسبة الحضور محسوبة (${att.current.rate ?? "—"}% من ${att.current.total} تسجيل)`);
  else bad("attendance.current.rate مش رقم");

  const s = d.sessions as { current: { total: number }; previous: { total: number } } | undefined;
  if (s && typeof s.current.total === "number" && typeof s.previous.total === "number") ok(`الحصص: الحالية ${s.current.total} · السابقة ${s.previous.total}`);
  else bad("sessions ناقصة");

  if (typeof d.start === "string" && typeof d.prevEnd === "string" && d.prevEnd < (d.start as string)) ok(`حدود المقارنة سليمة (${d.prevEnd} < ${d.start})`);
  else bad("حدود الفترة السابقة غلط");

  if (Array.isArray(d.worstGroups)) ok(`أكتر المجموعات غيابًا: ${(d.worstGroups as { name: string; rate: number }[]).map((g) => `${g.name} ${g.rate}%`).join(" · ") || "مفيش داتا كفاية (بيتقال بصراحة)"}`);
  else bad("worstGroups مش قائمة");

  const col = d.collection as { currentPiastres: number; changePct: number | null; mtdPiastres: number } | undefined;
  if (col && typeof col.currentPiastres === "number" && typeof col.mtdPiastres === "number") ok(`التحصيل ${Math.round(col.currentPiastres / 100)}ج · تغير ${col.changePct ?? "—"}% · من أول الشهر ${Math.round(col.mtdPiastres / 100)}ج`);
  else bad("collection ناقصة للمدير");

  if (Array.isArray(d.unclosedSessions) && Array.isArray(d.followUpStudents)) ok(`حصص ما اتقفلتش: ${(d.unclosedSessions as unknown[]).length} · محتاجين متابعة: ${(d.followUpStudents as unknown[]).length}`);
  else bad("unclosed/followUp ناقصة");

  const card = out.cards?.[0];
  if (card?.type === "report" && card.rows?.length) ok(`كارت تقرير بـ ${card.rows.length} صف وإجراءات تنقل`);
  else bad("كارت التقرير ناقص");

  // ==== 2) شهر — التجميع الشهري ====
  const outM = await tool.handler({ period: "month" }, mctx);
  const dm = (outM.data ?? {}) as { period?: string; collection?: { mtdPiastres: number } };
  if (dm.period === "month" && dm.collection && typeof dm.collection.mtdPiastres === "number") ok("فترة الشهر: تحصيل من أول الشهر محسوب");
  else bad("فترة الشهر ناقصة");

  // ==== 3) بوابة الصلاحيات — مدرس من غير VIEW_REPORTS ====
  const tctx = ctxFor("TEACHER", []);
  try {
    await authorizeAndValidate(tool, { period: "week" }, tctx);
    bad("مدرس من غير صلاحية عدى بوابة التفويض!");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("عرض التقارير")) ok("مدرس من غير صلاحية اتحجب من التحليل (PERMISSION)");
    else bad(`اتحجب برسالة غلط: ${msg}`);
  }

  // ==== 4) حقن centerId من الموديل — بيتشال في الـ schema ====
  const injected = await authorizeAndValidate(tool, { period: "week", centerId: "CENTER-اخرى", studentId: "x" }, mctx);
  const clean = injected.args as Record<string, unknown>;
  if (!("centerId" in clean) && !("studentId" in clean)) ok("حقن centerId/studentId اتشالوا (zod strip) — العزل محفوظ");
  else bad("مفاتيح حقن عدت من السكيما!");

  // ==== 5) مدرس بيركب على التحقق مباشرة بعد ما الصلاحية عدت (نظرًا لنظام الأدوار) ====
  // ملاحظة: نفس البوابة بتتطبق قبل handler في الـ runner دايمًا — هنا بنأكد إن الاعتماد على
  // authorizeAndValidate لوحده مش كفاية لو حد نادي handler على طول. الخدمة بتتحقق تاني؟
  // الأداة بتعتمد على صلاحية مالية للمستخدم جواها (hasFin) — فالمدرس حتى لو عدى هيشوف أرقام حضور بس من غير مالية.
  const tOut = await tool.handler({ period: "week" }, ctxFor("TEACHER", ["VIEW_REPORTS"]));
  const dt = (tOut.data ?? {}) as { collection?: unknown };
  if (tOut.summary && dt.collection === undefined) ok("مدرس معاه VIEW_REPORTS بس: شاف التحليل من غير أرقام مالية");
  else bad("فلترة المالية جوه الأداة مش شغالة");

  console.log(`\n===== ${pass} نجح · ${fail} فشل =====`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => { console.error("💥 خطأ:", e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => process.exit(0));
