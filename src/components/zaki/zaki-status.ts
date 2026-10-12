import type { RobotHeadState } from "robot-heads";

/* ============================================================
   Zaki robot state mapping — الطبقة الوحيدة اللي بترجم حالة
   الوكيل الحقيقية لحالة الروبوت البصرية.
   ❗ سياسة صارمة (MASTER PROMPT §5): ممنوع اختراع حالات —
   كل تحويل هنا لازم يقابل حدث حقيقي من الـ agent.
============================================================ */

/** حالات الروبوت المدعومة من مكتبة robot-heads v0.3.0 */
export type ZakiRobotState = RobotHeadState;

/** إشارات الوكيل الحقيقية الواصلة من SSE (بدون أي تخمين) */
export interface ZakiStatusInput {
  /** حالة الـ orchestrator السيرفرية: IDLE / UNDERSTANDING / ANALYZING / PLANNING / EXECUTING / VERIFYING / TRANSCRIBING / WAITING_CONFIRMATION / COMPLETED / FAILED */
  agentState: string;
  /** طلب شغال فعليًا (SSE مفتوح) */
  running: boolean;
  /** جلسة مايك حقيقية شغالة (تسجيل صوتي فعلي) */
  listening: boolean;
  /** تحويل صوت لنص جاري (بعد إنهاء التسجيل) */
  transcribing: boolean;
  /** صوت زكي بيعمل play الآن (TTS حقيقي — سيرفري أو متصفح) */
  speaking: boolean;
  /** نجاح مؤكد للتو (حدث done بـ COMPLETED) — عابر */
  celebrate: boolean;
  /** فشل مؤكد للتو (حدث error أو done بـ FAILED) — عابر */
  fail: boolean;
}

/**
 * أولوية التحويل — كل قاعدة مقابلة لحدث حقيقي:
 *  1. listening  → جلسة مايك فعلية شغالة.
 *  2. speaking   → صوت TTS شغال فعلًا.
 *  3. running    → EXECUTING/VERIFYING = أداة حقيقية شغالة (working)،
 *                  غيرها (فهم/تحليل/تخطيط/تحويل صوت) = تفكير (thinking).
 *  4. fail       → فشل مؤكد (عابر ثم يرجع idle من الهوك).
 *  5. celebrate  → نجاح مؤكد (عابر ثم يرجع idle من الهوك).
 *  6. غير كده    → idle (الحياد الصادق).
 *
 * ملاحظات مقصودة:
 *  - "searching" مش مستخدمة: السيرفر مبيرسلش حدث بحث مميز —
 *    وعرضها مجرد "تفكير" ممنوع صريحًا (§5 rule 1).
 *  - "sleeping" مش مستخدمة: مفيش workflow خمول حقيقي في التطبيق.
 */
export function mapZakiRobotState(input: ZakiStatusInput): ZakiRobotState {
  if (input.listening) return "listening";
  if (input.speaking) return "speaking";
  if (input.running) {
    const s = (input.agentState ?? "").toUpperCase();
    if (s === "EXECUTING" || s === "VERIFYING") return "working";
    return "thinking";
  }
  if (input.fail) return "error";
  if (input.celebrate) return "happy";
  return "idle";
}

/** وصف عربي مختصر لكل حالة — للـ sr-only وللنص القريب من الروبوت */
export const ZAKI_STATE_AR: Record<ZakiRobotState, string> = {
  idle: "زكي جاهز",
  thinking: "زكي بيفكر",
  searching: "زكي بيدور",
  listening: "زكي بيسمع",
  speaking: "زكي بيتكلم",
  working: "زكي بينفذ",
  happy: "زكي مبسوط — تمام",
  error: "زكي شاف مشكلة",
  sleeping: "زكي نايم",
};

/** لون نقطة الحالة (صفحة ألوان البراند) — الحالة مش معتمدة على الأنيميشن وحده */
export const ZAKI_STATE_DOT: Record<ZakiRobotState, string> = {
  idle: "bg-emerald-500",
  thinking: "bg-amber-500",
  searching: "bg-sky-500",
  listening: "bg-rose-500",
  speaking: "bg-sky-500",
  working: "bg-blue-600",
  happy: "bg-emerald-500",
  error: "bg-rose-600",
  sleeping: "bg-zinc-400",
};
