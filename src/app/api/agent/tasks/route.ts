import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/agent/tasks — تاريخ مهام الوكيل للمستخدم الحالي */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const tasks = await db.agentTask.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true, title: true, status: true, createdAt: true, error: true,
      _count: { select: { executions: true } },
    },
  });
  return ok({ tasks });
});
