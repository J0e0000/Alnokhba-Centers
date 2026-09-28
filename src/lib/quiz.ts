import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";

/* ============================================================
   كويزات بسيطة (spec §1) — بدون بنك أسئلة عمدًا:
   الأسئلة أطفال مباشرين للكويز. مفيش إعادة استخدام معمارية.
   الأنواع: MCQ (اختيار من متعدد) | TRUE_FALSE | WRITTEN (تصحيح يدوي).
   التصحيح: MCQ/TRUE_FALSE أوتوماتيك، WRITTEN بيتصحح يدوي من الموظف/المدرس.
============================================================ */

export type QuizQuestionInput = {
  text?: string;
  type?: string;
  options?: unknown;
  correctAnswer?: unknown;
  points?: number;
};

export function normalizeQuestions(raw: unknown): {
  order: number; text: string; type: "MCQ" | "TRUE_FALSE" | "WRITTEN";
  options: string | null; correctAnswer: string | null; points: number;
}[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError("الكويز محتاج سؤال واحد على الأقل.", 400);
  }
  if (raw.length > 50) throw new ApiError("الحد الأقصى 50 سؤال في الكويز.", 400);
  return raw.map((q, i) => {
    const input = q as QuizQuestionInput;
    const text = String(input.text ?? "").trim();
    if (!text) throw new ApiError(`السؤال رقم ${i + 1} فاضي.`, 400);
    const type = ["MCQ", "TRUE_FALSE", "WRITTEN"].includes(String(input.type)) ? (input.type as "MCQ" | "TRUE_FALSE" | "WRITTEN") : "MCQ";
    let options: string | null = null;
    let correctAnswer: string | null = null;
    let points = Number(input.points ?? 1);
    if (!Number.isFinite(points) || points < 1 || points > 100) points = 1;
    if (type === "MCQ") {
      const opts = Array.isArray(input.options) ? input.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (opts.length < 2 || opts.length > 6) throw new ApiError(`السؤال رقم ${i + 1}: اختيارات لازم تكون من 2 لـ 6.`, 400);
      options = JSON.stringify(opts);
      const idx = Number(input.correctAnswer);
      if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) {
        throw new ApiError(`السؤال رقم ${i + 1}: حدد الإجابة الصحيحة.`, 400);
      }
      correctAnswer = String(idx);
    } else if (type === "TRUE_FALSE") {
      correctAnswer = input.correctAnswer === "false" ? "false" : "true";
    } // WRITTEN: يتصحح يدويًا
    return { order: i, text, type, options, correctAnswer, points };
  });
}

export async function assertGroupInCenter(centerId: string, groupId: string) {
  const g = await db.group.findFirst({ where: { id: groupId, centerId }, select: { id: true } });
  if (!g) throw new ApiError("المجموعة دي مش موجودة في سنترك.", 404);
}

export function quizWindowOk(q: { status: string; opensAt: Date | null; closesAt: Date | null }): { ok: boolean; reason?: string } {
  if (q.status !== "PUBLISHED") return { ok: false, reason: "الكويز مش منشور لسه." };
  const now = new Date();
  if (q.opensAt && now < q.opensAt) return { ok: false, reason: "الكويز لسه ما فتحش — استنى موعد الفتح." };
  if (q.closesAt && now > q.closesAt) return { ok: false, reason: "وقت الكويز خلص." };
  return { ok: true };
}

/** تصحيح آلي للإجابات (MCQ/TRUE_FALSE) — يعيد (score, perQuestion) */
export function autoGrade(
  questions: { id: string; type: string; correctAnswer: string | null; points: number }[],
  answers: { questionId: string; answer: string }[],
): { score: number; maxScore: number; perQuestion: Record<string, boolean>; hasWritten: boolean } {
  const byId = new Map(answers.map((a) => [String(a.questionId), String(a.answer ?? "").trim()]));
  let score = 0;
  let maxScore = 0;
  let hasWritten = false;
  const perQuestion: Record<string, boolean> = {};
  for (const q of questions) {
    maxScore += q.points;
    if (q.type === "WRITTEN") { hasWritten = true; continue; }
    const given = byId.get(q.id) ?? "";
    const okAns = q.correctAnswer != null && given !== "" && given === q.correctAnswer;
    perQuestion[q.id] = okAns;
    if (okAns) score += q.points;
  }
  return { score, maxScore, perQuestion, hasWritten };
}
