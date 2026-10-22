import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/announcements/[id] — حذف إعلان منشور (المدير أو صاحبه).
 * بيتمسح الإعلان + كل إشعاراته من بورتال الطلاب (الرسايل بتختفي من عند الطلاب كمان).
 * Push إشعارات اللي وصلت موبايلات مش بتتراجع — ده طبيعة الإشعارات.
 */
export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  if (user.role === "TEACHER") {
    throw new ApiError("حذف الإعلانات للمدير والاستقبال بس.", 403);
  }
  const { id } = await ctx.params;

  const announcement = await db.announcement.findFirst({ where: { id, centerId: user.centerId } });
  if (!announcement) throw new ApiError("الإعلان ده مش موجود أو اتمسح قبل كده.", 404);
  // صاحب الإعلان يمسحه، والمدير يمسح أي إعلان — الاستقبال مش بيمسح إعلانات غيره
  if (user.role !== "MANAGER" && announcement.createdBy !== user.id) {
    throw new ApiError("مش إعلانك — حذف إعلانات غيرك للمدير بس.", 403);
  }

  const notifCount = await db.studentNotification.count({ where: { announcementId: announcement.id } });
  await db.studentNotification.deleteMany({ where: { announcementId: announcement.id } });
  await db.announcement.delete({ where: { id: announcement.id } });

  await logAudit({
    user,
    action: AUDIT.ANNOUNCEMENT_DELETED,
    entity: "ANNOUNCEMENT",
    entityId: announcement.id,
    before: { title: announcement.title, audience: announcement.audienceName, recipients: announcement.recipients },
    after: null,
    reason: `حذف إعلان منشور (${notifCount} إشعار طالب اتمسح معاه)`,
  });

  return ok({
    deleted: true,
    title: announcement.title,
    removedNotifications: notifCount,
    message: `الإعلان «${announcement.title}» اتمسح — اختفى من بورتال ${notifCount} طالب.`,
  });
});
