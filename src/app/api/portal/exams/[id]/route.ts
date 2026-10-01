import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { rateLimit, ApiError } from "@/lib/auth";
import { getPortalStudent, destroyPortalSession } from "@/lib/portal-auth";
import { buildAttemptOrders, sanitizeQuestionsForStudent, gradeObjectiveAttempt, assertStudentInGroup } from "@/lib/exam";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * الامتحان من ناحية الطالب — السيرفر هو مصدر الحقيقة الوحيد (spec §2):
 * - GET            → حالة الامتحان (ready | running | result) + الوقت المتبقي محسوب سيرفرًا
 * - POST start     → فتح محاولة: startedAt/expiresAt من ساعة السيرفر + ترتيب shuffle محفوظ
 * - POST state     → إعادة مزامنة (refresh/عودة بعد انقطاع) — نفس GET
 * - POST answer    → حفظ إجابة واحدة (مرفوض بعد expiresAt)
 * - POST submit    → تسليم: التصحيح server-side بالكامل (يدوي أو أوتوماتيك عند انتهاء الوقت)
 * - POST event     → حدث أمني (ترك الصفحة/فول سكرين...) — STRICT بيلغي المحاولة فورًا
 * مفيش attemptId بيجي من العميل أبدًا — بيتستخرج من هوية الطالب + الامتحان.
 * مفيش إجابة صحيحة بتتنشر قبل التسليم.
 */

type RouteCtx = { params: Promise<{ id: string }> };
const SUBMIT_GRACE_MS = 10_000; // سماح بسيط لطلبات submit اللي كانت في الطريق لما الوقت خلص
const VIOLATIONS = new Set(["TAB_HIDDEN", "PAGE_LEFT", "FULLSCREEN_EXIT", "FOCUS_LOST"]);

async function loadExam(centerId: string, examId: string) {
  const exam = await db.exam.findFirst({
    where: { id: examId, centerId, status: { in: ["PUBLISHED", "CLOSED"] } },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!exam) throw new ApiError("الامتحان مش موجود.", 404);
  return exam;
}

async function loadAttempt(examId: string, studentId: string) {
  return db.examAttempt.findUnique({
    where: { examId_studentId: { examId, studentId } },
    include: { answers: true },
  });
}

/** تسليم المحاولة وتصحيحها server-side — idempotent */
async function submitAttempt(
  attempt: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>,
  questions: { id: string; type: string; options: string | null; correctAnswer: string | null; points: number }[],
  opts: { auto: boolean; centerId: string; studentId: string; forced?: boolean },
) {
  const { gradeObjectiveAttempt } = await import("@/lib/exam");
  const { score } = gradeObjectiveAttempt(questions, attempt.answers, attempt.optionOrder ? JSON.parse(attempt.optionOrder) : null);
  const auto = opts.auto || attempt.expiresAt < new Date();
  const status = opts.forced ? "INVALIDATED" : auto ? "AUTO_SUBMITTED" : "SUBMITTED";
  const submittedAt = opts.forced ? new Date() : attempt.expiresAt < new Date() ? attempt.expiresAt : new Date();
  await db.examAttempt.update({ where: { id: attempt.id }, data: { status, submittedAt, score } });
  await db.examSecurityEvent.create({
    data: { centerId: opts.centerId, attemptId: attempt.id, studentId: opts.studentId, type: opts.forced ? "ATTEMPT_INVALIDATED" : auto ? "EXAM_AUTO_SUBMITTED" : "EXAM_SUBMITTED" },
  }).catch(() => {});
  return { status, score, submittedAt };
}

/** بناء حالة "شغالة" للطالب — الوقت المتبقي دايمًا من السيرفر */
function runningPayload(exam: Awaited<ReturnType<typeof loadExam>>, attempt: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>, now: Date) {
  return {
    phase: "running" as const,
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    remainingMs: Math.max(0, attempt.expiresAt.getTime() - now.getTime()),
    serverNow: now,
    allowAnswerEdit: exam.allowAnswerEdit,
    securityMode: exam.securityMode,
    title: exam.title,
    instructions: exam.instructions,
    maxScore: exam.maxScore,
    questions: sanitizeQuestionsForStudent(
      exam.questions,
      JSON.parse(attempt.questionOrder) as string[],
      attempt.optionOrder ? JSON.parse(attempt.optionOrder) : null,
    ),
    answers: attempt.answers.map((a) => ({ questionId: a.questionId, answer: a.answer })),
  };
}

export const GET = handler(async (_req: Request, ctx: RouteCtx) => {
  const st = await getPortalStudent();
  if (!st) throw new ApiError("سجل دخولك الأول.", 401);
  const { id } = await ctx.params;
  const exam = await loadExam(st.centerId, id);
  const now = new Date();
  const attempt = await loadAttempt(exam.id, st.id);

  if (attempt && attempt.status === "IN_PROGRESS") {
    if (attempt.expiresAt < now) {
      const res = await submitAttempt(attempt, exam.questions, { auto: true, centerId: st.centerId, studentId: st.id });
      return ok({ ...resultPayload(exam, res.status, res.score, res.submittedAt), phase: "result" as const, serverNow: now });
    }
    return ok({ ...runningPayload(exam, attempt, now), serverNow: now });
  }

  if (attempt && attempt.status !== "IN_PROGRESS") {
    return ok({ ...resultPayload(exam, attempt.status, attempt.score, attempt.submittedAt), phase: "result" as const, serverNow: now });
  }

  // مفيش محاولة — المتاح: ready داخل النافذة فقط
  if (exam.status === "CLOSED") return ok({ phase: "closed" as const, serverNow: now });
  if (now < exam.startAt) return ok({ phase: "notyet" as const, startAt: exam.startAt, serverNow: now });
  if (now > exam.endAt) return ok({ phase: "missed" as const, serverNow: now });

  return ok({
    phase: "ready" as const,
    title: exam.title,
    instructions: exam.instructions,
    durationMin: exam.durationMin,
    maxScore: exam.maxScore,
    questionsCount: exam.questions.length,
    securityMode: exam.securityMode,
    endAt: exam.endAt,
    reviewVideoUrl: exam.reviewVideoUrl,
    serverNow: now,
  });
});

function resultPayload(
  exam: Awaited<ReturnType<typeof loadExam>>,
  status: string,
  score: number | null,
  submittedAt: Date | null,
) {
  return {
    title: exam.title,
    maxScore: exam.maxScore,
    status,
    score,
    submittedAt,
    reviewVideoUrl: exam.reviewVideoUrl,
    durationMin: exam.durationMin,
  };
}

type PostBody = { action?: string; questionId?: string; answer?: string; type?: string; auto?: boolean };

export const POST = handler(async (req: Request, ctx: RouteCtx) => {
  const st = await getPortalStudent();
  if (!st) throw new ApiError("سجل دخولك الأول.", 401);
  const { id } = await ctx.params;
  const body = await readJson<PostBody>(req);
  const action = String(body.action ?? "");
  const now = new Date();

  // ============================= بدء محاولة =============================
  if (action === "start") {
    rateLimit(`exam-start:${st.id}`, 6, 60_000);
    const exam = await loadExam(st.centerId, id);
    if (exam.status !== "PUBLISHED") throw new ApiError("الامتحان مش متاح.", 400);
    if (now < exam.startAt) throw new ApiError("الامتحان لسه ما فتحش.", 400);
    if (now > exam.endAt) throw new ApiError("وقت الامتحان خلص.", 400);
    await assertStudentInGroup(st.id, exam.groupId);

    const existing = await loadAttempt(exam.id, st.id);
    if (existing) {
      if (existing.status === "IN_PROGRESS") {
        return ok(existing.expiresAt < now
          ? { ...(await submitAttempt(existing, exam.questions, { auto: true, centerId: st.centerId, studentId: st.id })), phase: "result" }
          : { ...runningPayload(exam, existing, now), phase: "running" });
      }
      throw new ApiError("استخدمت محاولتك في الامتحان ده بالفعل.", 409);
    }

    const orders = buildAttemptOrders(exam.questions, exam.shuffleQuestions, exam.shuffleOptions);
    const expiresAt = new Date(now.getTime() + exam.durationMin * 60_000); // السيرفر بيحدد — مش الجهاز
    const ua = req.headers.get("user-agent")?.slice(0, 250) ?? null;
    const attempt = await db.examAttempt.create({
      data: {
        examId: exam.id, studentId: st.id, centerId: st.centerId,
        startedAt: now, expiresAt,
        questionOrder: JSON.stringify(orders.questionOrder),
        optionOrder: orders.optionOrder ? JSON.stringify(orders.optionOrder) : null,
        userAgent: ua,
      },
      include: { answers: true },
    });
    await db.examSecurityEvent.create({
      data: { centerId: st.centerId, attemptId: attempt.id, studentId: st.id, type: "EXAM_STARTED", meta: JSON.stringify({ ua }) },
    }).catch(() => {});
    await logAudit({
      user: { id: st.id, name: st.name, centerId: st.centerId },
      action: AUDIT.EXAM_ATTEMPT_ACTION, entity: "EXAM_ATTEMPT", entityId: attempt.id,
      after: { started: true, exam: exam.title }, reason: "بدء محاولة امتحان",
    });
    return ok({ ...runningPayload(exam, attempt, now), phase: "running" });
  }

  // ============================= باقي الإجراءات محتاجة محاولة =============================
  const exam = await loadExam(st.centerId, id);
  const attempt = await loadAttempt(exam.id, st.id);
  if (!attempt) throw new ApiError("مفيش محاولة مفتوحة — ابدأ الامتحان الأول.", 404);

  // المحاولة خلصت وقتها وهي شغالة → سيبها للسيرفر يسلمها بنفسه
  if (attempt.status === "IN_PROGRESS" && attempt.expiresAt < now) {
    const res = await submitAttempt(attempt, exam.questions, { auto: true, centerId: st.centerId, studentId: st.id });
    return ok({ ...resultPayload(exam, res.status, res.score, res.submittedAt), phase: "result", serverNow: now, expired: true });
  }
  if (attempt.status !== "IN_PROGRESS") {
    // تسليم مكرر/replay → رجّع نفس النتيجة من غير إعادة تصحيح
    return ok({ ...resultPayload(exam, attempt.status, attempt.score, attempt.submittedAt), phase: "result", serverNow: now, replay: true });
  }

  // ============================= حفظ إجابة =============================
  if (action === "answer") {
    rateLimit(`exam-ans:${st.id}`, 90, 60_000);
    const questionId = String(body.questionId ?? "");
    const answer = String(body.answer ?? "").slice(0, 200);
    if (!questionId || !exam.questions.some((q) => q.id === questionId)) throw new ApiError("سؤال مش موجود في الامتحان ده.", 400);
    if (attempt.expiresAt < now) throw new ApiError("الوقت خلص — الإجابة مش هتتحفظ.", 410);
    if (!exam.allowAnswerEdit) {
      const has = attempt.answers.some((a) => a.questionId === questionId);
      if (has) return ok({ ok: true, locked: true }); // أول إجابة بتثبت — من غير رسالة غلط
    }
    await db.examAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
      create: { attemptId: attempt.id, questionId, answer },
      update: { answer, savedAt: new Date() },
    });
    return ok({ ok: true });
  }

  // ============================= تسليم =============================
  if (action === "submit") {
    rateLimit(`exam-submit:${st.id}`, 8, 60_000);
    const manual = !body.auto;
    if (manual && attempt.expiresAt < new Date(now.getTime() - SUBMIT_GRACE_MS)) {
      // تسليم يدوي بعد الوقت — السيرفر بيرفضه ويسلّم المحاولة أوتوماتيك
      const res = await submitAttempt(attempt, exam.questions, { auto: true, centerId: st.centerId, studentId: st.id });
      return ok({ ...resultPayload(exam, res.status, res.score, res.submittedAt), phase: "result", serverNow: now, expired: true });
    }
    const res = await submitAttempt(attempt, exam.questions, { auto: !!body.auto, centerId: st.centerId, studentId: st.id });
    return ok({ ...resultPayload(exam, res.status, res.score, res.submittedAt), phase: "result", serverNow: now });
  }

  // ============================= حدث أمني =============================
  if (action === "event") {
    rateLimit(`exam-ev:${st.id}`, 30, 60_000);
    const type = String(body.type ?? "");
    if (!VIOLATIONS.has(type)) return ok({ ok: true }); // أنواع تانية متقبلة من العميل مش مهمة

    await db.examSecurityEvent.create({
      data: { centerId: st.centerId, attemptId: attempt.id, studentId: st.id, type },
    });

    if (exam.securityMode === "STRICT") {
      // السياسة الصارمة: إنهاء فوري — آخر إجابات معروفة محفوظة بالفعل، والتصحيح يتسجل
      const { score } = gradeObjectiveAttempt(exam.questions, attempt.answers, attempt.optionOrder ? JSON.parse(attempt.optionOrder) : null);
      await db.examAttempt.update({
        where: { id: attempt.id },
        data: { status: "INVALIDATED", submittedAt: new Date(), score },
      });
      await db.examSecurityEvent.create({
        data: { centerId: st.centerId, attemptId: attempt.id, studentId: st.id, type: "ATTEMPT_INVALIDATED", meta: JSON.stringify({ trigger: type }) },
      });
      await destroyPortalSession().catch(() => {}); // إنهاء جلسة الطالب الحالية (spec §4)
      await logAudit({
        user: { id: st.id, name: st.name, centerId: st.centerId },
        action: AUDIT.EXAM_ATTEMPT_ACTION, entity: "EXAM_ATTEMPT", entityId: attempt.id,
        after: { invalidated: true, trigger: type }, reason: `إنهاء محاولة امتحان (سياسة صارمة) — ${exam.title}`,
      });
      return ok({ terminated: true, reason: type });
    }
    return ok({ warned: true });
  }

  throw new ApiError("إجراء غير معروف.", 400);
});
