import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { executeUndo, executeRedo } from "@/lib/undo";

export const dynamic = "force-dynamic";

/**
 * GET /api/undo — آخر الأفعال القابلة للتراجع/الإعادة للمستخدم الحالي
 * POST { op: "undo" | "redo", entryId? } — تنفيذ أحدث (أو محدد)
 */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const [undoable, redoable] = await Promise.all([
    db.undoEntry.findMany({
      where: { centerId: user.centerId, userId: user.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, label: true, entity: true, action: true, createdAt: true },
    }),
    db.undoEntry.findMany({
      where: { centerId: user.centerId, userId: user.id, status: "UNDONE" },
      orderBy: { undoneAt: "desc" },
      take: 5,
      select: { id: true, label: true, entity: true, action: true, createdAt: true },
    }),
  ]);
  return ok({ undoable, redoable });
});

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<{ op?: string; entryId?: string }>(req);
  const op = String(body.op ?? "");
  if (op !== "undo" && op !== "redo") throw new ApiError("طلب غير معروف.", 400);
  const undoUser = { id: user.id, name: user.name, centerId: user.centerId };
  const res = op === "undo"
    ? await executeUndo(undoUser, body.entryId ? String(body.entryId) : undefined)
    : await executeRedo(undoUser, body.entryId ? String(body.entryId) : undefined);
  return ok(res);
});
