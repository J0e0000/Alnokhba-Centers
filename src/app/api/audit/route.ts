import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireUser, ApiError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/audit?action=&page= — center audit trail (manager); admin sees platform-wide */
export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  if (user.role === "RECEPTIONIST") {
    throw new ApiError("سجل العمليات للمدير بس.", 403);
  }
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = 40;

  const where =
    user.role === "ADMIN"
      ? {}
      : { centerId: user.centerId };

  const [total, actions, logs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["action"], _count: { action: true }, where, orderBy: { _count: { action: "desc" } }, take: 30 }),
    db.auditLog.findMany({
      where: { ...(action ? { action } : {}), ...where },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return ok({
    total,
    page,
    pageSize,
    actions: actions.map((a) => ({ action: a.action, count: a._count.action })),
    logs: logs.map((l) => ({
      id: l.id, userName: l.userName, action: l.action,
      entity: l.entity, entityId: l.entityId,
      before: l.before ? safeParse(l.before) : null,
      after: l.after ? safeParse(l.after) : null,
      reason: l.reason, createdAt: l.createdAt,
      centerId: l.centerId,
    })),
  });
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
