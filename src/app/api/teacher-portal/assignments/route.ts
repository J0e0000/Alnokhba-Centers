import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { getPortalTeacher } from "@/lib/teacher-auth";
import { normalizeObjectiveQuestions } from "@/lib/exam";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * بورتال المدرس — الواجبات
 * نفس فكرة الامتحانات بس الواجب بيتسلم لحد الـ deadline والطالب يقدر يسيب ويرجع.
 * GET            — واجبات مجموعاتي
 * GET ?id=       — تفاصيل واجب (أسئلة + تسليمات)
 * POST           — إنشاء واجب (Mode A — أونلاين تصحيح آلي)
 * PATCH {id,...} — publish | close | reopen | update
 * DELETE ?id=    — مسح مسودة من غير تسليمات
 */

async function requireTeacher() {
  const teacher = await getPortalTeacher();
  if (!teacher) throw new ApiError("سجل دخولك الأول.", 401);
  return teacher;
}

async function myGroupIds(teacherId: string): Promise<string[]> {
  const gs = await db.group.findMany({
    where: { teacherId, isActive: true },
    select: { id: true },
  });
  return gs.map((g) => g.id);
}

async function myAssignment(teacher: { id: string; centerId: string }, id: string) {
  const ids = await myGroupIds(teacher.id);
  const assignment = await db.assignment.findFirst({
    where: { id, centerId: teacher.centerId, groupId: { in: ids } },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      questions: { orderBy: { order: "asc" } },
      submissions: {
        include: { student: { select: { id: true, name: true, code: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!assignment) throw new ApiError("الواجب ده مش من واجبات مجموعاتك.", 404);
  return assignment;
}

function teacherAudit(teacher: { name: string; centerId: string }) {
  return { id: "anonymous", name: `مدرس: ${teacher.name}`, centerId: teacher.centerId };
}

export const GET = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const a = await myAssignment(teacher, id);
    return ok({
      assignment: {
        id: a.id, title: a.title, instructions: a.instructions, status: a.status, mode: a.mode,
        groupId: a.groupId, groupName: a.group.name, subject: a.group.subject.name,
        deadline: a.deadline, allowLate: a.allowLate, maxScore: a.maxScore,
        reviewVideoUrl: a.reviewVideoUrl,
        questions: a.questions.map((q) => ({
          id: q.id, order: q.order, text: q.text, type: q.type, options: q.options,
          correctAnswer: q.correctAnswer, points: q.points,
        })),
        submissions: a.submissions.map((s) => ({
          id: s.id, studentName: s.student.name, studentCode: s.student.code,
          status: s.status, score: s.score, late: s.late,
          draftSavedAt: s.draftSavedAt, submittedAt: s.submittedAt,
        })),
        submissionsCount: a.submissions.length,
      },
    });
  }

  const [ids, groups] = await Promise.all([
    myGroupIds(teacher.id),
    db.group.findMany({
      where: { teacherId: teacher.id, isActive: true },
      select: { id: true, name: true, subject: { select: { name: true } }, grade: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const assignments = ids.length
    ? await db.assignment.findMany({
        where: { centerId: teacher.centerId, groupId: { in: ids }, mode: "ONLINE" },
        include: {
          group: { select: { name: true, subject: { select: { name: true } } } },
          _count: { select: { questions: true, submissions: true } },
          submissions: { select: { score: true, status: true, late: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return ok({
    teacher: { name: teacher.name, center: teacher.center },
    groups: groups.map((g) => ({ id: g.id, name: g.name, subject: g.subject.name, grade: g.grade.name })),
    assignments: assignments.map((a) => {
      const graded = a.submissions.filter((s) => s.score != null);
      const avg = graded.length
        ? Math.round(graded.reduce((s, x) => s + ((x.score ?? 0) / (a.maxScore || 1)) * 100, 0) / graded.length)
        : null;
      return {
        id: a.id, title: a.title, instructions: a.instructions, status: a.status, mode: a.mode,
        groupId: a.groupId, groupName: a.group.name, subject: a.group.subject.name,
        deadline: a.deadline, allowLate: a.allowLate, maxScore: a.maxScore,
        reviewVideoUrl: a.reviewVideoUrl,
        questionsCount: a._count.questions, submissionsCount: a._count.submissions,
        avgPct: avg,
        createdAt: a.createdAt, createdByName: a.createdByName,
      };
    }),
  });
});

type AssignmentBody = {
  id?: string;
  action?: string;
  groupId?: string;
  title?: string;
  instructions?: string;
  deadline?: string;
  allowLate?: boolean;
  reviewVideoUrl?: string;
  publish?: boolean;
  questions?: unknown;
};

export const POST = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  rateLimit(`teacher-assignment:${teacher.id}`, 30, 60_000);
  const body = await readJson<AssignmentBody>(req);

  const groupId = String(body.groupId ?? "");
  const title = String(body.title ?? "").trim();
  if (!groupId) throw new ApiError("اختار المجموعة الأول.", 400);
  if (title.length < 3) throw new ApiError("عنوان الواجب محتاج 3 حروف على الأقل.", 400);

  const ids = await myGroupIds(teacher.id);
  if (!ids.includes(groupId)) throw new ApiError("المجموعة دي مش من مجموعاتك.", 403);

  const deadline = body.deadline ? new Date(String(body.deadline)) : null;
  if (!deadline || isNaN(deadline.getTime())) throw new ApiError("حدد ميعاد التسليم (deadline).", 400);

  const questions = normalizeObjectiveQuestions(body.questions, "الواجب");
  const maxScore = questions.reduce((s, q) => s + q.points, 0);

  const reviewVideoUrl = body.reviewVideoUrl ? String(body.reviewVideoUrl).trim() || null : null;
  if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
    throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
  }

  const assignment = await db.assignment.create({
    data: {
      centerId: teacher.centerId,
      groupId,
      title,
      instructions: body.instructions ? String(body.instructions).trim() || null : null,
      mode: "ONLINE",
      status: body.publish ? "PUBLISHED" : "DRAFT",
      deadline,
      allowLate: !!body.allowLate,
      maxScore,
      reviewVideoUrl,
      createdById: teacher.id,
      createdByName: teacher.name,
      questions: { create: questions },
    },
    select: { id: true, title: true, status: true },
  });

  await logAudit({
    user: teacherAudit(teacher),
    action: AUDIT.ASSIGNMENT_CREATED,
    entity: "ASSIGNMENT",
    entityId: assignment.id,
    after: { title: assignment.title, questions: questions.length, maxScore, status: assignment.status, by: "teacher-portal" },
  });

  return ok({ assignment });
});

export const PATCH = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  rateLimit(`teacher-assignment:${teacher.id}`, 30, 60_000);
  const body = await readJson<AssignmentBody>(req);
  const assignment = await myAssignment(teacher, String(body.id ?? ""));
  const action = String(body.action ?? "");

  if (action === "publish" || action === "close" || action === "reopen") {
    if (action === "publish") {
      if (assignment.status === "PUBLISHED") throw new ApiError("الواجب منشور بالفعل.", 400);
      if (assignment.questions.length === 0) throw new ApiError("الواجب محتاج أسئلة قبل النشر.", 400);
      await db.assignment.update({ where: { id: assignment.id }, data: { status: "PUBLISHED" } });
    } else if (action === "close") {
      if (assignment.status !== "PUBLISHED") throw new ApiError("الواجب مش منشور أصلاً.", 400);
      await db.assignment.update({ where: { id: assignment.id }, data: { status: "CLOSED" } });
    } else {
      if (assignment.status !== "CLOSED") throw new ApiError("الواجب مش مقفول.", 400);
      await db.assignment.update({ where: { id: assignment.id }, data: { status: "PUBLISHED" } });
    }
    await logAudit({
      user: teacherAudit(teacher), entity: "ASSIGNMENT", entityId: assignment.id,
      action: action === "publish" ? AUDIT.ASSIGNMENT_PUBLISHED : action === "close" ? AUDIT.ASSIGNMENT_CLOSED : AUDIT.ASSIGNMENT_UPDATED,
      after: { status: action === "close" ? "CLOSED" : "PUBLISHED", by: "teacher-portal" },
    });
    return ok({ ok: true });
  }

  if (action === "update") {
    if (assignment.status === "CLOSED") throw new ApiError("الواجب مقفول — مينفعش يتعدل.", 400);
    const hasSubmissions = assignment.submissions.length > 0;
    const questions = body.questions !== undefined ? normalizeObjectiveQuestions(body.questions, "الواجب") : null;

    const deadline = body.deadline ? new Date(String(body.deadline)) : assignment.deadline;
    if (isNaN(deadline.getTime())) throw new ApiError("ميعاد التسليم مش مظبوط.", 400);

    if (hasSubmissions && questions) {
      throw new ApiError("مينفعش تعدل الأسئلة بعد بدء التسليمات.", 400);
    }
    const reviewVideoUrl = body.reviewVideoUrl !== undefined
      ? (String(body.reviewVideoUrl ?? "").trim() || null)
      : assignment.reviewVideoUrl;
    if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
      throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
    }

    const data: Record<string, unknown> = {
      title: body.title !== undefined ? String(body.title).trim() || assignment.title : assignment.title,
      instructions: body.instructions !== undefined ? (String(body.instructions ?? "").trim() || null) : assignment.instructions,
      deadline,
      allowLate: body.allowLate !== undefined ? !!body.allowLate : assignment.allowLate,
      reviewVideoUrl,
    };
    if (questions) {
      data.maxScore = questions.reduce((s, q) => s + q.points, 0);
      data.questions = { deleteMany: {}, create: questions };
    }

    await db.assignment.update({ where: { id: assignment.id }, data });
    await logAudit({
      user: teacherAudit(teacher), action: AUDIT.ASSIGNMENT_UPDATED, entity: "ASSIGNMENT", entityId: assignment.id,
      after: { title: data.title, by: "teacher-portal" },
    });
    return ok({ ok: true });
  }

  throw new ApiError("إجراء غير معروف.", 400);
});

export const DELETE = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  const url = new URL(req.url);
  const assignment = await myAssignment(teacher, url.searchParams.get("id") ?? "");
  if (assignment.status !== "DRAFT") throw new ApiError("بتمسح المسودات بس — واجب منشور اقفله الأول.", 400);
  if (assignment.submissions.length > 0) throw new ApiError("في تسليمات على الواجب ده — مينفعش يمسح.", 400);
  await db.assignment.delete({ where: { id: assignment.id } });
  await logAudit({
    user: teacherAudit(teacher), action: AUDIT.ASSIGNMENT_UPDATED, entity: "ASSIGNMENT", entityId: assignment.id,
    after: { deleted: true, by: "teacher-portal" },
  });
  return ok({ ok: true });
});
