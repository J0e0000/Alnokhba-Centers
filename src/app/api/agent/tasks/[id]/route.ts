import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/agent/tasks/[id] — تفاصيل مهمة: الرسائل + الخطوات + التأكيدات (قابلة للتفتيش) */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;
  const task = await db.agentTask.findFirst({
    where: { id, userId: user.id },
    include: {
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, kind: true, content: true, createdAt: true } },
      executions: {
        orderBy: { createdAt: "asc" },
        select: { id: true, toolName: true, status: true, risk: true, input: true, output: true, error: true, durationMs: true, confirmedBy: true, createdAt: true },
      },
      confirmations: {
        orderBy: { createdAt: "asc" },
        select: { id: true, toolName: true, summary: true, status: true, risk: true, decidedBy: true, decidedAt: true, createdAt: true },
      },
    },
  });
  if (!task) return Response.json({ ok: false, error: "المهمة دي مش موجودة." }, { status: 404 });
  return ok({
    task: {
      id: task.id, title: task.title, goal: task.goal, status: task.status,
      plan: task.plan, result: task.result, error: task.error,
      provider: task.provider, createdAt: task.createdAt,
      messages: task.messages, executions: task.executions, confirmations: task.confirmations,
    },
  });
});
