import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireUser, ApiError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/staff — إشعارات الموظف الحالي (مدير/أدمن/استقبال).
 * سريعة ومباشرة من الداتابيز — الواجهة بتقراها بالبولينج كل 15 ثانية.
 */
export const GET = handler(async () => {
  const user = await requireUser();
  const [items, unread] = await Promise.all([
    db.staffNotification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.staffNotification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return ok({
    unread,
    notifications: items.map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body,
      link: n.link, refId: n.refId, read: !!n.readAt, createdAt: n.createdAt,
    })),
  });
});

type Body = { action?: "read" | "readAll"; id?: string };

/** POST /api/notifications/staff — تحديد مقروء (واحد أو الكل) */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson<Body>(req);

  if (body.action === "readAll") {
    const r = await db.staffNotification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ marked: r.count });
  }

  if (body.action === "read" && body.id) {
    await db.staffNotification.updateMany({
      where: { id: String(body.id), userId: user.id },
      data: { readAt: new Date() },
    });
    return ok({ marked: 1 });
  }

  throw new ApiError("طلب غير معروف.", 400);
});
