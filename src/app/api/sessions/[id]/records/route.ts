import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type RecordBody = {
  studentId?: string;
  // الواجب — 3 حالات زي المنصة الأساسية (مكتمل/ناقص/لم يتم) + null = مسح الرصد
  homeworkStatus?: "DONE" | "PARTIAL" | "MISSING" | null;
  // التفاعل — عدّاد ضغطات: ＋ تفاعل / − مخالفة
  interaction?: "plus" | "minus";
  interactionDelta?: number; // افتراضي 1 (ضغطة واحدة)
};

/**
 * POST /api/sessions/[id]/records — التفاعل والواجب (نقل من المنصة الأساسية).
 * للحاضرين بس: الطالب اللي مالوش صف حضور في الحصة دي بيرفض (الغايب مش بيتفاعل ولا بيسلّم واجب).
 * الحصة المفتوحة: أي موظف. المقفولة: المدير أو صاحب صلاحية EDIT_ATTENDANCE (وضع تعديل حصة قديمة).
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;
  const body = await readJson<RecordBody>(req);

  const session = await db.sessionInstance.findFirst({ where: { id, centerId: user.centerId } });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status !== "OPEN" && !(user.role === "MANAGER" || hasPermission(user, "EDIT_ATTENDANCE"))) {
    throw new ApiError("الحصة مقفولة — التعديل للمدير أو صاحب صلاحية تعديل الحضور.", 403);
  }
  if (session.status === "CANCELLED") throw new ApiError("الحصة دي متلغاة.", 409);

  const studentId = String(body.studentId ?? "");
  if (!studentId) throw new ApiError("حدد الطالب.", 400);

  const row = await db.attendance.findFirst({ where: { sessionId: id, studentId } });
  if (!row) throw new ApiError("الطالب ده مش مسجل حاضر في الحصة دي.", 404);

  const data: { homeworkStatus?: string | null; interactionPlus?: { increment: number }; interactionMinus?: { increment: number } } = {};

  if (body.homeworkStatus !== undefined) {
    if (body.homeworkStatus === null) data.homeworkStatus = null;
    else if (["DONE", "PARTIAL", "MISSING"].includes(body.homeworkStatus)) data.homeworkStatus = body.homeworkStatus;
    else throw new ApiError("حالة الواجب مش معروفة.", 400);
  }

  if (body.interaction) {
    const delta = Math.max(1, Math.min(5, Math.round(Number(body.interactionDelta ?? 1))));
    if (body.interaction === "plus") data.interactionPlus = { increment: delta };
    else data.interactionMinus = { increment: delta };
  }

  if (!Object.keys(data).length) throw new ApiError("مفيش تغييرات.", 400);

  const updated = await db.attendance.update({ where: { id: row.id }, data });

  return ok({
    studentId,
    homeworkStatus: updated.homeworkStatus,
    interactionPlus: updated.interactionPlus,
    interactionMinus: updated.interactionMinus,
  });
});
