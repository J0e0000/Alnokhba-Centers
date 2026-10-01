import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { rateLimit, ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";
import { sanitizeQuestionsForStudent, gradeObjectiveAttempt, assertStudentInGroup } from "@/lib/exam";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * الواجب من ناحية الطالب — قابل للاستكمال (مش جلسة صارمة زي الامتحان):
 * - GET          → فتح الواجب: الأسئلة + المسودة المحفوظة + الوقت المتبقي (سيرفر)
 * - POST save    → حفظ المسودة (يقدر يسيب ويرجع براحته)
 * - POST submit  → تسليم: بعد الـ deadline مرفوض إلا لو allowLate (يتعلّم late)
 * التصحيح server-side بالكامل — الدرجة تظهر فورًا + فيديو المراجعة لو موجود.
 */

type RouteCtx = { params: Promise<{ id: string }> };

async function loadAssignment(centerId: string, assignmentId: string) {
  const a = await db.assignment.findFirst({
    where: { id: assignmentId, centerId, status: { in: ["PUBLISHED", "CLOSED"] } },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!a) throw new ApiError("الواجب مش موجود.", 404);
  return a;
}

function submittedPayload(a: Awaited<ReturnType<typeof loadAssignment>>, sub: { status: string; score: number | null; late: boolean; submittedAt: Date | null }) {
  return {
    phase: "submitted" as const,
    title: a.title,
    maxScore: a.maxScore,
    status: sub.status,
    score: sub.score,
    late: sub.late,
    submittedAt: sub.submittedAt,
    reviewVideoUrl: a.reviewVideoUrl,
  };
}

export const GET = handler(async (_req: Request, ctx: RouteCtx) => {
  const st = await getPortalStudent();
  if (!st) throw new ApiError("سجل دخولك الأول.", 401);
  const { id } = await ctx.params;
  const a = await loadAssignment(st.centerId, id);
  await assertStudentInGroup(st.id, a.groupId);
  const now = new Date();

  const sub = await db.assignmentSubmission.findUnique({
    where: { assignmentId_studentId: { assignmentId: a.id, studentId: st.id } },
  });

  if (sub && sub.status !== "DRAFT") {
    return ok({ ...submittedPayload(a, sub), serverNow: now });
  }
  if (a.status === "CLOSED") return ok({ phase: "closed" as const, serverNow: now });

  const answers = sub?.answers ? (JSON.parse(sub.answers) as { questionId: string; answer: string }[]) : [];
  return ok({
    phase: "open" as const,
    title: a.title,
    instructions: a.instructions,
    mode: a.mode,
    deadline: a.deadline,
    remainingMs: Math.max(0, a.deadline.getTime() - now.getTime()),
    allowLate: a.allowLate,
    maxScore: a.maxScore,
    questions: sanitizeQuestionsForStudent(a.questions, a.questions.map((q) => q.id), null),
    answers,
    draftSavedAt: sub?.draftSavedAt ?? null,
    serverNow: now,
  });
});

type PostBody = { action?: string; answers?: { questionId?: string; answer?: string }[] };

export const POST = handler(async (req: Request, ctx: RouteCtx) => {
  const st = await getPortalStudent();
  if (!st) throw new ApiError("سجل دخولك الأول.", 401);
  const { id } = await ctx.params;
  const body = await readJson<PostBody>(req);
  const action = String(body.action ?? "");
  const now = new Date();

  const a = await loadAssignment(st.centerId, id);
  await assertStudentInGroup(st.id, a.groupId);

  const existing = await db.assignmentSubmission.findUnique({
    where: { assignmentId_studentId: { assignmentId: a.id, studentId: st.id } },
  });

  if (a.status === "CLOSED") throw new ApiError("الواجب مقفول.", 400);

  // نظّف الإجابات الواردة: أسئلة تخص الواجب بس
  const cleanAnswers = (Array.isArray(body.answers) ? body.answers : [])
    .map((x) => ({ questionId: String(x.questionId ?? ""), answer: String(x.answer ?? "").slice(0, 200) }))
    .filter((x) => x.questionId && a.questions.some((q) => q.id === x.questionId));

  // ============================= حفظ مسودة =============================
  if (action === "save") {
    rateLimit(`assign-save:${st.id}`, 40, 60_000);
    if (existing && existing.status !== "DRAFT") {
      return ok({ ok: true, alreadySubmitted: true }); // متأخر على التسليم — المسودة مش هتغيّر حاجة
    }
    if (now > a.deadline && !a.allowLate) throw new ApiError("ميعاد التسليم خلص — مش هينفع تحفظ بعد الميعاد.", 410);
    const data = {
      answers: JSON.stringify(cleanAnswers),
      draftSavedAt: new Date(),
    };
    if (existing) {
      await db.assignmentSubmission.update({ where: { id: existing.id }, data });
    } else {
      await db.assignmentSubmission.create({
        data: { assignmentId: a.id, studentId: st.id, centerId: st.centerId, status: "DRAFT", ...data },
      });
    }
    return ok({ ok: true, savedAt: new Date() });
  }

  // ============================= تسليم =============================
  if (action === "submit") {
    rateLimit(`assign-submit:${st.id}`, 8, 60_000);
    if (existing && existing.status !== "DRAFT") {
      return ok({ ...submittedPayload(a, existing), serverNow: now, replay: true });
    }
    const late = now > a.deadline;
    if (late && !a.allowLate) throw new ApiError("ميعاد التسليم خلص — التسليم بعد الميعاد مش مسموح في الواجب ده.", 410);

    const { gradeObjectiveAttempt } = await import("@/lib/exam");
    const { score } = gradeObjectiveAttempt(a.questions, cleanAnswers, null);
    const data = {
      status: "SUBMITTED" as const,
      answers: JSON.stringify(cleanAnswers),
      submittedAt: now,
      late,
      score,
    };
    const sub = existing
      ? await db.assignmentSubmission.update({ where: { id: existing.id }, data })
      : await db.assignmentSubmission.create({
          data: { assignmentId: a.id, studentId: st.id, centerId: st.centerId, ...data },
        });
    await logAudit({
      user: { id: st.id, name: st.name, centerId: st.centerId },
      action: AUDIT.ASSIGNMENT_UPDATED, entity: "ASSIGNMENT_SUBMISSION", entityId: sub.id,
      after: { submitted: true, late, score }, reason: `تسليم واجب — ${a.title}`,
    });
    return ok({ ...submittedPayload(a, sub), serverNow: now });
  }

  throw new ApiError("إجراء غير معروف.", 400);
});
