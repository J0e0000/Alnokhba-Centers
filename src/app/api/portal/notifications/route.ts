import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const TYPE_META: Record<string, { icon: string; label: string }> = {
  ANNOUNCEMENT: { icon: "📢", label: "إعلان" },
  SCHEDULE_CHANGE: { icon: "📅", label: "تحديث جدول" },
  TIME_CHANGE: { icon: "⏰", label: "تغيير ميعاد" },
  LOCATION_CHANGE: { icon: "📍", label: "تغيير مكان" },
  PAYMENT: { icon: "💰", label: "دفعة" },
  REFUND: { icon: "↩️", label: "استرداد" },
  ADJUSTMENT: { icon: "⚖️", label: "تسوية" },
  EXAM: { icon: "📝", label: "امتحان" },
  ASSIGNMENT: { icon: "📚", label: "واجب" },
};

/** GET /api/portal/notifications — رسائل الطالب (إعلانات + إشعارات النظام) + الغير مقروء */
export const GET = handler(async () => {
  const student = await getPortalStudent();
  if (!student) return ok({ student: null, notifications: [], unread: 0 });

  const [items, unread] = await Promise.all([
    db.studentNotification.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        announcement: { select: { audienceName: true, createdByName: true } },
      },
    }),
    db.studentNotification.count({ where: { studentId: student.id, readAt: null } }),
  ]);

  return ok({
    student: { name: student.name },
    unread,
    notifications: items.map((n) => ({
      id: n.id, type: n.type, typeMeta: TYPE_META[n.type] ?? TYPE_META.ANNOUNCEMENT,
      title: n.title, body: n.body, read: !!n.readAt, createdAt: n.createdAt,
      announcement: n.announcement
        ? { audienceName: n.announcement.audienceName, senderName: n.announcement.createdByName }
        : null,
    })),
  });
});

type Body = { action?: string; id?: string };

/** POST /api/portal/notifications — تحديد مقروء (واحد أو الكل) */
export const POST = handler(async (req: Request) => {
  const student = await getPortalStudent();
  if (!student) throw new ApiError("لازم تسجل دخول الأول.", 401);
  const body = await readJson<Body>(req);

  if (body.action === "readAll") {
    const r = await db.studentNotification.updateMany({
      where: { studentId: student.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ marked: r.count });
  }

  if (body.action === "read" && body.id) {
    await db.studentNotification.updateMany({
      where: { id: String(body.id), studentId: student.id },
      data: { readAt: new Date() },
    });
    return ok({ marked: 1 });
  }

  throw new ApiError("طلب غير معروف.", 400);
});
