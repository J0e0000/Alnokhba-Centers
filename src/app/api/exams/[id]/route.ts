import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { normalizeObjectiveQuestions, gradeObjectiveAttempt } from "@/lib/exam";
import { logAudit, AUDIT } from "@/lib/audit";
import { notifyGroupStudents } from "@/lib/notify";
import { notifyStaff } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id] — تفاصيل الامتحان للموظفين (بالأسئلة + المحاولات + الأحداث الأمنية)
 * PATCH — إجراءات:
 *   publish | close | reopen
 *   update (تعديل آمن — الأسئلة بطلبه فقط لو مفيش محاولات)
 *   forceSubmit  (MANAGER فقط — إغلاق محاولة شغالة وتصحيحها فورًا)
 *   resetAttempt (MANAGER فقط — مسح المحاولة عشان الطالب يعيد، بالسبب)
 * DELETE — مسح DRAFT بدون محاولات فقط
 */
type RouteCtx = { params: Promise<{ id: string }> };

async function getExam(centerId: string, id: string) {
  const exam = await db.exam.findFirst({
    where: { id, centerId },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      questions: { orderBy: { order: "asc" } },
      attempts: {
        include: {
          student: { select: { id: true, name: true, code: true } },
          securityEvents: { orderBy: { createdAt: "desc" }, take: 12 },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!exam) throw new ApiError("الامتحان مش موجود.", 404);
  return exam;
}

export const GET = handler(async (_req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "exams");
  const { id } = await ctx.params;
  const exam = await getExam(user.centerId, id);
  return ok({
    exam: {
      id: exam.id, title: exam.title, instructions: exam.instructions, status: exam.status,
      groupId: exam.groupId, groupName: exam.group.name, subject: exam.group.subject.name,
      startAt: exam.startAt, endAt: exam.endAt, durationMin: exam.durationMin,
      maxScore: exam.maxScore, attemptsAllowed: exam.attemptsAllowed,
      shuffleQuestions: exam.shuffleQuestions, shuffleOptions: exam.shuffleOptions,
      allowAnswerEdit: exam.allowAnswerEdit, securityMode: exam.securityMode,
      reviewVideoUrl: exam.reviewVideoUrl,
      questions: exam.questions,
      attempts: exam.attempts.map((a) => ({
        id: a.id, status: a.status, score: a.score, maxScore: exam.maxScore,
        startedAt: a.startedAt, expiresAt: a.expiresAt, submittedAt: a.submittedAt,
        student: a.student,
        securityEvents: a.securityEvents.map((ev) => ({ id: ev.id, type: ev.type, createdAt: ev.createdAt })),
      })),
    },
  });
});

type PatchBody = {
  action?: string;
  attemptId?: string;
  reason?: string;
  // update fields
  title?: string;
  instructions?: string | null;
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  attemptsAllowed?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  allowAnswerEdit?: boolean;
  securityMode?: string;
  reviewVideoUrl?: string | null;
  questions?: unknown;
};

export const PATCH = handler(async (req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "exams");
  const { id } = await ctx.params;
  const body = await readJson<PatchBody>(req);
  const exam = await getExam(user.centerId, id);
  const action = String(body.action ?? "");

  // ============================= نشر/قفل/إعادة =============================
  if (action === "publish" || action === "close" || action === "reopen") {
    if (action === "publish") {
      if (exam.status === "PUBLISHED") throw new ApiError("الامتحان منشور بالفعل.", 400);
      if (exam.questions.length === 0) throw new ApiError("الامتحان محتاج أسئلة قبل النشر.", 400);
      await db.exam.update({ where: { id: exam.id }, data: { status: "PUBLISHED" } });
      // إشعار فوري لطلاب المجموعة — جوّه التطبيق + Web Push لو التطبيق مقفول
      void notifyGroupStudents(
        user.centerId, exam.groupId, "EXAM",
        `امتحان جديد: ${exam.title}`,
        "اتفرج على تبويب الامتحانات في البورتال — بالتوفيق!",
        "/portal?tab=exams",
      ).catch(() => {});
      // إشعار للفريق الشغال (مدير + مدرس) — حد يشاركه مع الطلاب
      void notifyStaff(user.centerId, {
        type: "PUBLISH",
        title: `امتحان جديد: ${exam.title}`,
        body: `${exam.group.subject.name} — ${exam.group.name}. شاركه مع الطلاب من شاشة الامتحانات (زرار مشاركة).`,
        link: "exams",
        refId: exam.id,
      }, { roles: ["MANAGER", "TEACHER"] }).catch(() => {});
    } else if (action === "close") {
      await db.exam.update({ where: { id: exam.id }, data: { status: "CLOSED" } });
    } else {
      await db.exam.update({ where: { id: exam.id }, data: { status: "DRAFT" } });
    }
    await logAudit({
      user, action: action === "publish" ? AUDIT.EXAM_PUBLISHED : action === "close" ? AUDIT.EXAM_CLOSED : AUDIT.EXAM_UPDATED,
      entity: "EXAM", entityId: exam.id, after: { status: action }, reason: body.reason,
    });
    return ok({ ok: true });
  }

  // ============================= إغلاق محاولة قسريًا (MANAGER) =============================
  if (action === "forceSubmit") {
    await requireManager();
    const attempt = await db.examAttempt.findFirst({
      where: { id: String(body.attemptId ?? ""), examId: exam.id },
      include: { answers: true },
    });
    if (!attempt) throw new ApiError("المحاولة مش موجودة.", 404);
    if (attempt.status !== "IN_PROGRESS") throw new ApiError("المحاولة دي مش شغالة أصلاً.", 400);
    const { score } = gradeObjectiveAttempt(exam.questions, attempt.answers, attempt.optionOrder ? JSON.parse(attempt.optionOrder) : null);
    await db.examAttempt.update({
      where: { id: attempt.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), score },
    });
    await db.examSecurityEvent.create({
      data: { centerId: exam.centerId, attemptId: attempt.id, studentId: attempt.studentId, type: "EXAM_SUBMITTED", meta: JSON.stringify({ by: "STAFF_FORCE" }) },
    });
    await logAudit({
      user, action: AUDIT.EXAM_ATTEMPT_ACTION, entity: "EXAM_ATTEMPT", entityId: attempt.id,
      after: { forced: "SUBMITTED", score }, reason: `إغلاق قسري لمحاولة ${exam.title}${body.reason ? ` — ${body.reason}` : ""}`,
    });
    return ok({ ok: true });
  }

  // ============================= تصفير محاولة (MANAGER) =============================
  if (action === "resetAttempt") {
    await requireManager();
    const attempt = await db.examAttempt.findFirst({
      where: { id: String(body.attemptId ?? ""), examId: exam.id },
      include: { student: { select: { name: true } } },
    });
    if (!attempt) throw new ApiError("المحاولة مش موجودة.", 404);
    if (attempt.status === "IN_PROGRESS") {
      throw new ApiError("المحاولة لسه شغالة — أغلقها قسريًا الأول لو محتاج.", 400);
    }
    await db.examAttempt.delete({ where: { id: attempt.id } }); // الإجابات والأحداث بتمسح معاها (cascade)
    await logAudit({
      user, action: AUDIT.EXAM_ATTEMPT_ACTION, entity: "EXAM_ATTEMPT", entityId: attempt.id,
      after: { reset: true }, reason: `تصفير محاولة ${attempt.student.name} في ${exam.title}${body.reason ? ` — ${body.reason}` : ""}`,
    });
    return ok({ ok: true });
  }

  // ============================= تعديل =============================
  if (action === "update") {
    if (exam.status === "CLOSED") throw new ApiError("الامتحان مقفول — مينفعش يتعدل.", 400);
    const hasAttempts = exam.attempts.length > 0;
    const questions = body.questions !== undefined ? normalizeObjectiveQuestions(body.questions, "الامتحان") : null;

    const startAt = body.startAt ? new Date(String(body.startAt)) : exam.startAt;
    const endAt = body.endAt ? new Date(String(body.endAt)) : exam.endAt;
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new ApiError("نافذة الامتحان مش مظبوطة.", 400);
    }
    // لو في محاولات شغالة: نهاية النافذة مينفعش تيجي قبل انتهاء أطول محاولة
    const maxExpires = exam.attempts.filter((a) => a.status === "IN_PROGRESS").reduce((m, a) => (a.expiresAt > m ? a.expiresAt : m), new Date(0));
    if (endAt < maxExpires) throw new ApiError("في محاولات شغالة تمتد بعد النهاية الجديدة — اقفلها الأول.", 400);

    const durationMin = body.durationMin !== undefined ? Math.round(Number(body.durationMin)) : exam.durationMin;
    if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 300) {
      throw new ApiError("مدة الامتحان لازم تكون بين 1 و 300 دقيقة.", 400);
    }
    if (hasAttempts && questions) {
      throw new ApiError("مينفعش تعدل الأسئلة بعد بدء المحاولات.", 400);
    }
    const reviewVideoUrl = body.reviewVideoUrl !== undefined
      ? (String(body.reviewVideoUrl ?? "").trim() || null)
      : exam.reviewVideoUrl;
    if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
      throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
    }

    const data: Record<string, unknown> = {
      title: body.title !== undefined ? String(body.title).trim() || exam.title : exam.title,
      instructions: body.instructions !== undefined ? (String(body.instructions ?? "").trim() || null) : exam.instructions,
      startAt, endAt, durationMin,
      attemptsAllowed: body.attemptsAllowed !== undefined ? Math.max(1, Math.min(3, Math.round(Number(body.attemptsAllowed)) || 1)) : exam.attemptsAllowed,
      shuffleQuestions: body.shuffleQuestions !== undefined ? !!body.shuffleQuestions : exam.shuffleQuestions,
      shuffleOptions: body.shuffleOptions !== undefined ? !!body.shuffleOptions : exam.shuffleOptions,
      allowAnswerEdit: body.allowAnswerEdit !== undefined ? !!body.allowAnswerEdit : exam.allowAnswerEdit,
      securityMode: body.securityMode !== undefined ? (body.securityMode === "STRICT" ? "STRICT" : "WARNING") : exam.securityMode,
      reviewVideoUrl,
    };
    if (questions) {
      data.maxScore = questions.reduce((s, q) => s + q.points, 0);
      data.questions = {
        deleteMany: {},
        create: questions,
      };
    }

    await db.exam.update({ where: { id: exam.id }, data });
    await logAudit({
      user, action: AUDIT.EXAM_UPDATED, entity: "EXAM", entityId: exam.id,
      after: { title: data.title, questions: questions ? questions.length : undefined, securityMode: data.securityMode },
      reason: body.reason,
    });
    return ok({ ok: true });
  }

  throw new ApiError("إجراء غير معروف.", 400);
});

export const DELETE = handler(async (_req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "exams");
  const { id } = await ctx.params;
  const exam = await getExam(user.centerId, id);
  if (exam.status !== "DRAFT" || exam.attempts.length > 0) {
    throw new ApiError("الامتحان المشهور أو اللي فيه محاولات مبيتمسش — اقفله بدل المسح.", 400);
  }
  await db.exam.delete({ where: { id: exam.id } });
  await logAudit({ user, action: AUDIT.EXAM_DELETED, entity: "EXAM", entityId: exam.id, after: { title: exam.title } });
  return ok({ ok: true });
});
