import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { normalizeObjectiveQuestions } from "@/lib/exam";
import { logAudit, AUDIT } from "@/lib/audit";
import { notifyGroupStudents } from "@/lib/notify";
import { notifyStaff } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments/[id] — تفاصيل الواجب للموظفين (الأسئلة + التسليمات)
 * PATCH — إجراءات: publish | close | reopen | update (آمن حسب حالت التسليمات) | grade (رصد درجة يدوي)
 * DELETE — مسح DRAFT بدون تسليمات فقط
 */
type RouteCtx = { params: Promise<{ id: string }> };

async function getAssignment(centerId: string, id: string) {
  const assignment = await db.assignment.findFirst({
    where: { id, centerId },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      questions: { orderBy: { order: "asc" } },
      submissions: {
        include: { student: { select: { id: true, name: true, code: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!assignment) throw new ApiError("الواجب مش موجود.", 404);
  return assignment;
}

export const GET = handler(async (_req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "assignments");
  const { id } = await ctx.params;
  const a = await getAssignment(user.centerId, id);
  return ok({
    assignment: {
      id: a.id, title: a.title, instructions: a.instructions, mode: a.mode, status: a.status,
      groupId: a.groupId, groupName: a.group.name, subject: a.group.subject.name,
      deadline: a.deadline, allowLate: a.allowLate, maxScore: a.maxScore,
      reviewVideoUrl: a.reviewVideoUrl,
      questions: a.questions,
      submissions: a.submissions.map((s) => ({
        id: s.id, status: s.status, score: s.score, late: s.late,
        draftSavedAt: s.draftSavedAt, submittedAt: s.submittedAt,
        student: s.student,
      })),
    },
  });
});

type PatchBody = {
  action?: string;
  submissionId?: string;
  score?: number;
  reason?: string;
  title?: string;
  instructions?: string | null;
  deadline?: string;
  allowLate?: boolean;
  reviewVideoUrl?: string | null;
  questions?: unknown;
};

export const PATCH = handler(async (req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "assignments");
  const { id } = await ctx.params;
  const body = await readJson<PatchBody>(req);
  const a = await getAssignment(user.centerId, id);
  const action = String(body.action ?? "");

  if (action === "publish" || action === "close" || action === "reopen") {
    if (action === "publish") {
      if (a.status === "PUBLISHED") throw new ApiError("الواجب منشور بالفعل.", 400);
      if (a.questions.length === 0) throw new ApiError("الواجب محتاج أسئلة قبل النشر.", 400);
      await db.assignment.update({ where: { id: a.id }, data: { status: "PUBLISHED" } });
      // إشعار فوري لطلاب المجموعة — جوّه التطبيق + Web Push لو التطبيق مقفول
      void notifyGroupStudents(
        user.centerId, a.groupId, "ASSIGNMENT",
        `واجب جديد: ${a.title}`,
        "افتح تبويب الواجبات في البورتال وسلّم قبل الميعاد.",
        "/portal?tab=assignments",
      ).catch(() => {});
      // إشعار للفريق الشغال (مدير + مدرس) — حد يشاركه مع الطلاب
      void notifyStaff(user.centerId, {
        type: "PUBLISH",
        title: `واجب جديد: ${a.title}`,
        body: `${a.group.subject.name} — ${a.group.name}. شاركه مع الطلاب من شاشة الواجبات (زرار مشاركة).`,
        link: "assignments",
        refId: a.id,
      }, { roles: ["MANAGER", "TEACHER"] }).catch(() => {});
    } else if (action === "close") {
      await db.assignment.update({ where: { id: a.id }, data: { status: "CLOSED" } });
    } else {
      await db.assignment.update({ where: { id: a.id }, data: { status: "DRAFT" } });
    }
    await logAudit({
      user, action: action === "publish" ? AUDIT.ASSIGNMENT_PUBLISHED : action === "close" ? AUDIT.ASSIGNMENT_CLOSED : AUDIT.ASSIGNMENT_UPDATED,
      entity: "ASSIGNMENT", entityId: a.id, after: { status: action }, reason: body.reason,
    });
    return ok({ ok: true });
  }

  if (action === "grade") {
    const sub = await db.assignmentSubmission.findFirst({
      where: { id: String(body.submissionId ?? ""), assignmentId: a.id },
    });
    if (!sub) throw new ApiError("التسليم مش موجود.", 404);
    if (sub.status === "DRAFT") throw new ApiError("الطالب لسه ما سلمّش — مفيش حاجة تتصحح.", 400);
    const score = Math.round(Number(body.score));
    if (!Number.isFinite(score) || score < 0 || score > (a.maxScore || 0)) {
      throw new ApiError(`الدرجة لازم تكون بين 0 و ${a.maxScore}.`, 400);
    }
    await db.assignmentSubmission.update({
      where: { id: sub.id },
      data: { score, status: "GRADED", gradedAt: new Date(), gradedById: user.id },
    });
    await logAudit({
      user, action: AUDIT.ASSIGNMENT_GRADED, entity: "ASSIGNMENT_SUBMISSION", entityId: sub.id,
      after: { score }, reason: `تصحيح يدوي — ${a.title}`,
    });
    return ok({ ok: true });
  }

  if (action === "update") {
    if (a.status === "CLOSED") throw new ApiError("الواجب مقفول — مينفعش يتعدل.", 400);
    const submittedCount = a.submissions.filter((s) => s.submittedAt).length;
    const questions = body.questions !== undefined ? normalizeObjectiveQuestions(body.questions, "الواجب") : null;
    if (submittedCount > 0 && questions) {
      throw new ApiError("مينفعش تعدل الأسئلة بعد بدء التسليمات.", 400);
    }
    const deadline = body.deadline ? new Date(String(body.deadline)) : a.deadline;
    if (isNaN(deadline.getTime())) throw new ApiError("ميعاد التسليم مش مظبوط.", 400);
    const reviewVideoUrl = body.reviewVideoUrl !== undefined ? (String(body.reviewVideoUrl ?? "").trim() || null) : a.reviewVideoUrl;
    if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
      throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
    }

    const data: Record<string, unknown> = {
      title: body.title !== undefined ? String(body.title).trim() || a.title : a.title,
      instructions: body.instructions !== undefined ? (String(body.instructions ?? "").trim() || null) : a.instructions,
      deadline,
      allowLate: body.allowLate !== undefined ? !!body.allowLate : a.allowLate,
      reviewVideoUrl,
    };
    if (questions) {
      data.maxScore = questions.reduce((s, q) => s + q.points, 0);
      data.questions = { deleteMany: {}, create: questions };
    }
    await db.assignment.update({ where: { id: a.id }, data });
    await logAudit({
      user, action: AUDIT.ASSIGNMENT_UPDATED, entity: "ASSIGNMENT", entityId: a.id,
      after: { title: data.title, deadline, questions: questions ? questions.length : undefined }, reason: body.reason,
    });
    return ok({ ok: true });
  }

  throw new ApiError("إجراء غير معروف.", 400);
});

export const DELETE = handler(async (_req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "assignments");
  const { id } = await ctx.params;
  const a = await getAssignment(user.centerId, id);
  const submittedCount = a.submissions.filter((s) => s.submittedAt).length;
  if (a.status !== "DRAFT" || submittedCount > 0) {
    throw new ApiError("الواجب المنشور أو اللي فيه تسليمات مبيتمسش — اقفله بدل المسح.", 400);
  }
  await db.assignment.delete({ where: { id: a.id } });
  await logAudit({ user, action: AUDIT.ASSIGNMENT_DELETED, entity: "ASSIGNMENT", entityId: a.id, after: { title: a.title } });
  return ok({ ok: true });
});
