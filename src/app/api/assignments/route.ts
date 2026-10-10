import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { normalizeObjectiveQuestions } from "@/lib/exam";
import { assertGroupInCenter } from "@/lib/quiz";
import { logAudit, AUDIT } from "@/lib/audit";
import { notifyGroupStudents } from "@/lib/notify";
import { notifyStaff } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments — قائمة واجبات السنتر (اختياري ?groupId=)
 * POST /api/assignments — إنشاء واجب (Mode A: ONLINE تصحيح آلي — Mode B: FILE جاي لاحقًا)
 * الواجب قابل للاستكمال: الطالب يسيب ويرجع لحد الـ deadline — الميعاد بيتقفل سيرفرًا.
 */

export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "assignments");
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId") ?? undefined;

  const assignments = await db.assignment.findMany({
    where: { centerId: user.centerId, ...(groupId ? { groupId } : {}) },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      _count: { select: { questions: true, submissions: true } },
      submissions: { select: { score: true, status: true, late: true, submittedAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return ok({
    assignments: assignments.map((a) => {
      const submitted = a.submissions.filter((s) => s.submittedAt);
      const late = submitted.filter((s) => s.late).length;
      return {
        id: a.id, title: a.title, instructions: a.instructions, mode: a.mode, status: a.status,
        groupId: a.groupId, groupName: a.group.name, subject: a.group.subject.name,
        deadline: a.deadline, allowLate: a.allowLate, maxScore: a.maxScore,
        reviewVideoUrl: a.reviewVideoUrl,
        questionsCount: a._count.questions,
        submissionsCount: submitted.length,
        lateCount: late,
        createdAt: a.createdAt, createdByName: a.createdByName,
      };
    }),
  });
});

type CreateBody = {
  groupId?: string;
  title?: string;
  instructions?: string;
  mode?: string;
  deadline?: string;
  allowLate?: boolean;
  reviewVideoUrl?: string;
  publish?: boolean;
  questions?: unknown;
};

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "assignments");
  const body = await readJson<CreateBody>(req);

  const groupId = String(body.groupId ?? "");
  const title = String(body.title ?? "").trim();
  if (!groupId) throw new ApiError("اختار المجموعة الأول.", 400);
  if (title.length < 3) throw new ApiError("عنوان الواجب محتاج 3 حروف على الأقل.", 400);
  await assertGroupInCenter(user.centerId, groupId);

  const mode = body.mode === "FILE" ? "FILE" : "ONLINE";
  if (mode === "FILE") throw new ApiError("تسليم الملفات لسه جاي — الواجب الأونلاين متاح دلوقتي.", 400);

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
      centerId: user.centerId,
      groupId,
      title,
      instructions: body.instructions ? String(body.instructions).trim() || null : null,
      mode,
      status: body.publish ? "PUBLISHED" : "DRAFT",
      deadline,
      allowLate: !!body.allowLate,
      maxScore,
      reviewVideoUrl,
      createdById: user.id,
      createdByName: user.name,
      questions: { create: questions },
    },
    select: { id: true, title: true, status: true },
  });

  await logAudit({
    user, action: AUDIT.ASSIGNMENT_CREATED, entity: "ASSIGNMENT", entityId: assignment.id,
    after: { title: assignment.title, questions: questions.length, maxScore, deadline, status: assignment.status },
  });

  // النشر من شاشة الإنشاء نفسه — نفس إشعارات النشر من شاشة التفاصيل
  if (body.publish) {
    const g = await db.group.findUnique({
      where: { id: groupId },
      select: { name: true, subject: { select: { name: true } } },
    });
    void notifyGroupStudents(
      user.centerId, groupId, "ASSIGNMENT",
      `واجب جديد: ${assignment.title}`,
      "افتح تبويب الواجبات في البورتال وسلّم قبل الميعاد.",
      "/portal?tab=assignments",
    ).catch(() => {});
    void notifyStaff(user.centerId, {
      type: "PUBLISH",
      title: `واجب جديد: ${assignment.title}`,
      body: `${g?.subject.name ?? ""} — ${g?.name ?? ""}. شاركه مع الطلاب من شاشة الواجبات (زرار مشاركة).`,
      link: "assignments",
      refId: assignment.id,
    }, { roles: ["MANAGER", "TEACHER"] }).catch(() => {});
  }

  return ok({ assignment });
});
