import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/assignments — واجبات مجموعات الطالب + حالة كل واجب (سيرفر-محسوبة)
 * الحالات: OPEN | IN_PROGRESS (فيه مسودة) | SUBMITTED | GRADED | MISSED | CLOSED
 */

export const GET = handler(async () => {
  const st = await getPortalStudent();
  if (!st) throw new ApiError("سجل دخولك الأول.", 401);

  const regs = await db.studentGroup.findMany({
    where: { studentId: st.id, status: "ACTIVE" },
    select: { groupId: true },
  });
  const groupIds = regs.map((r) => r.groupId);
  const now = new Date();

  const assignments = groupIds.length
    ? await db.assignment.findMany({
        where: { centerId: st.centerId, groupId: { in: groupIds }, status: { in: ["PUBLISHED", "CLOSED"] } },
        include: {
          group: { select: { name: true, subject: { select: { name: true } } } },
          submissions: { where: { studentId: st.id } },
        },
        orderBy: { deadline: "desc" },
        take: 60,
      })
    : [];

  const rows = assignments.map((a) => {
    const sub = a.submissions[0] ?? null;
    let state: string;
    if (a.status === "CLOSED") state = "CLOSED";
    else if (sub?.status === "GRADED") state = "GRADED";
    else if (sub?.status === "SUBMITTED") state = "SUBMITTED";
    else if (now > a.deadline) state = "MISSED";
    else if (sub?.status === "DRAFT") state = "IN_PROGRESS";
    else state = "OPEN";

    return {
      id: a.id,
      title: a.title,
      subject: a.group.subject.name,
      groupName: a.group.name,
      deadline: a.deadline,
      allowLate: a.allowLate,
      maxScore: a.maxScore,
      mode: a.mode,
      state,
      score: sub?.score ?? null,
      late: sub?.late ?? false,
      submittedAt: sub?.submittedAt ?? null,
      serverNow: now,
    };
  });

  return ok({ assignments: rows, serverNow: now });
});
