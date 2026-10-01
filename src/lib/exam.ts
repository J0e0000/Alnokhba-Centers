import "server-only";
import { randomBytes } from "crypto";
import { ApiError } from "@/lib/auth";

/* ============================================================
   الامتحانات الإلكترونية + الواجبات — helpers على السيرفر بس
   القواعد الذهبية (spec §2/§4/§15):
   - السيرفر هو مصدر الحقيقة: الوقت والدرجة والحالة والصلاحيات
   - الإجابات الصحيحة عمرها ما بتتنشر للطالب قبل التسليم
   - shuffle لكل محاولة بيتخزن على المحاولة نفسها (refresh-safe)
   - الدرجات بتتحسب server-side فقط عند التسليم
============================================================ */

export type ObjectiveType = "MCQ" | "TRUE_FALSE" | "NUM";

export type ObjectiveQuestionInput = {
  text?: string;
  type?: string;
  options?: unknown;
  correctAnswer?: unknown;
  points?: number;
};

const MAX_QUESTIONS = 100;

/** تطبيع الإجابة الرقمية: أرقام عربية → لاتيني، فواصل عربية → نقطة، إزالة مسافات/فواصل آلاف */
export function normalizeNumAnswer(raw: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  let s = String(raw ?? "").trim();
  s = s.replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)));
  // الفاصلة العشرية العربية (٫) والفاصلة الآلاف العربية (٬)
  s = s.replace(/\u066B/g, ".").replace(/\u066C/g, "");
  s = s.replace(/[,\s_]/g, "");
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s;
}

/** مقارنة إجابة رقمية: مساواة رقمية مع تسامح عشري بسيط، وإلا مقارنة نصية */
function numEquals(given: string, correct: string): boolean {
  const g = normalizeNumAnswer(given);
  const c = normalizeNumAnswer(correct);
  if (!g || !c) return false;
  const gn = Number(g);
  const cn = Number(c);
  if (Number.isFinite(gn) && Number.isFinite(cn)) return Math.abs(gn - cn) < 1e-9;
  return g === c;
}

/** تطبيع أسئلة موضوعية (امتحان/واجب) — زي normalizeQuestions بتاعة الكويزات + NUM */
export function normalizeObjectiveQuestions(
  raw: unknown,
  label: string,
): { order: number; text: string; type: ObjectiveType; options: string | null; correctAnswer: string | null; points: number }[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(`${label} محتاج سؤال واحد على الأقل.`, 400);
  }
  if (raw.length > MAX_QUESTIONS) throw new ApiError(`الحد الأقصى ${MAX_QUESTIONS} سؤال.`, 400);
  return raw.map((q, i) => {
    const input = q as ObjectiveQuestionInput;
    const text = String(input.text ?? "").trim();
    if (!text) throw new ApiError(`السؤال رقم ${i + 1} فاضي.`, 400);
    const type = (["MCQ", "TRUE_FALSE", "NUM"].includes(String(input.type)) ? String(input.type) : "MCQ") as ObjectiveType;
    let options: string | null = null;
    let correctAnswer: string | null = null;
    let points = Number(input.points ?? 1);
    if (!Number.isFinite(points) || points < 1 || points > 100) points = 1;
    if (type === "MCQ") {
      const opts = Array.isArray(input.options) ? input.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (opts.length < 2 || opts.length > 6) throw new ApiError(`السؤال رقم ${i + 1}: الاختيارات لازم تكون من 2 لـ 6.`, 400);
      options = JSON.stringify(opts);
      const idx = Number(input.correctAnswer);
      if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) {
        throw new ApiError(`السؤال رقم ${i + 1}: حدد الإجابة الصحيحة.`, 400);
      }
      correctAnswer = String(idx);
    } else if (type === "TRUE_FALSE") {
      correctAnswer = input.correctAnswer === "false" ? "false" : "true";
    } else {
      // NUM — إجابة رقمية موضوعية
      const norm = normalizeNumAnswer(String(input.correctAnswer ?? ""));
      if (!norm) throw new ApiError(`السؤال رقم ${i + 1}: اكتب الإجابة الرقمية الصحيحة.`, 400);
      correctAnswer = norm;
    }
    return { order: i, text, type, options, correctAnswer, points };
  });
}

export type QuestionLike = { id: string; type: string; options: string | null; correctAnswer: string | null; points: number };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** بناء ترتيب المحاولة (أسئلة + اختيارات) — بيتخزن على المحاولة للثبات عبر الـ refresh */
export function buildAttemptOrders(
  questions: { id: string; type: string; options: string | null }[],
  shuffleQuestions: boolean,
  shuffleOptions: boolean,
): { questionOrder: string[]; optionOrder: Record<string, number[]> | null } {
  let qIds = questions.map((q) => q.id);
  if (shuffleQuestions) qIds = shuffle(qIds);
  let optionOrder: Record<string, number[]> | null = null;
  if (shuffleOptions) {
    optionOrder = {};
    for (const q of questions) {
      if (q.type !== "MCQ" || !q.options) continue;
      const n = (JSON.parse(q.options) as string[]).length;
      optionOrder[q.id] = shuffle(Array.from({ length: n }, (_, i) => i));
    }
  }
  return { questionOrder: qIds, optionOrder };
}

export type StudentQuestion = {
  id: string;
  order: number;
  text: string;
  type: string;
  points: number;
  options: string[] | null; // بالترتيب المعروض للطالب
};

export type SanitizableQuestion = {
  id: string;
  text: string;
  type: string;
  options: string | null;
  correctAnswer: string | null;
  points: number;
};

/** تحضير الأسئلة للطالب — بدون الإجابات الصحيحة نهائيًا + بالترتيب المعروض */
export function sanitizeQuestionsForStudent(
  questions: SanitizableQuestion[],
  questionOrder: string[],
  optionOrder: Record<string, number[]> | null,
): StudentQuestion[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: StudentQuestion[] = [];
  questionOrder.forEach((qid, i) => {
    const q = byId.get(qid);
    if (!q) return;
    let opts: string[] | null = null;
    if (q.type === "MCQ" && q.options) {
      const orig = JSON.parse(q.options) as string[];
      const ord = optionOrder?.[qid];
      opts = ord ? ord.map((oi) => orig[oi]) : orig;
    }
    out.push({
      id: q.id,
      order: i + 1,
      text: q.text,
      type: q.type,
      points: q.points,
      options: opts,
    });
  });
  return out;
}

/** تصحيح موضوعي على السيرفر — MCQ بيمر على ترتيب العرض، NUM بمقارنة رقمية */
export function gradeObjectiveAttempt(
  questions: QuestionLike[],
  answers: { questionId: string; answer: string }[],
  optionOrder: Record<string, number[]> | null,
): { score: number; maxScore: number; perQuestion: Record<string, boolean> } {
  const byId = new Map(answers.map((a) => [String(a.questionId), String(a.answer ?? "").trim()]));
  let score = 0;
  let maxScore = 0;
  const perQuestion: Record<string, boolean> = {};
  for (const q of questions) {
    maxScore += q.points;
    const given = byId.get(q.id) ?? "";
    if (!given) { perQuestion[q.id] = false; continue; }
    let okAns = false;
    if (q.type === "MCQ") {
      const orig = optionOrder?.[q.id] ? optionOrder[q.id][Number(given)] : Number(given);
      okAns = q.correctAnswer != null && Number.isInteger(orig) && String(orig) === q.correctAnswer;
    } else if (q.type === "TRUE_FALSE") {
      okAns = q.correctAnswer != null && given === q.correctAnswer;
    } else if (q.type === "NUM") {
      okAns = q.correctAnswer != null && numEquals(given, q.correctAnswer);
    }
    perQuestion[q.id] = okAns;
    if (okAns) score += q.points;
  }
  return { score, maxScore, perQuestion };
}

/** التحقق من تسجيل الطالب في مجموعة (أي امتحان/واجب/حضور) */
export async function assertStudentInGroup(studentId: string, groupId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const reg = await db.studentGroup.findFirst({
    where: { studentId, groupId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!reg) throw new ApiError("انت مش مسجل في مجموعة المحتوى ده.", 403);
}
