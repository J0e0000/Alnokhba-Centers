import { handler, ok } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLLMStatus } from "@/ai/providers";
import { allTools, availableToolsFor } from "@/ai/tools";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/agent/status — حالة العقل والأدوات
   • أي مستخدم: الأدوات المتاحة له هو (صلاحيات + قدرات السنتر).
   • المدير بس: موديل شغال إيه + توزيع الطلبات آخر 7 أيام
     (llm / brain / fallback) + آخر طلبات «غير مفهومة» —
     دي قايمة الأدوات/النوايا الناقصة اللي المفروض تتضاف.
============================================================ */

export const GET = handler(async () => {
  const user = await requireCenterUser();
  const tools = await availableToolsFor({ user, centerId: user.centerId });
  const base = {
    tools: {
      total: allTools().length,
      available: tools.map((t) => ({ name: t.name, group: t.group, risk: t.risk })),
    },
  };
  if (user.role !== "MANAGER") return ok(base);

  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await db.agentTask.findMany({
    where: { centerId: user.centerId, createdAt: { gte: since } },
    select: { provider: true, status: true, goal: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const kind = (p: string | null) => (p === "brain" || p === "fallback" ? p : p ? "llm" : "unknown");
  const counts: Record<string, number> = { llm: 0, brain: 0, fallback: 0, unknown: 0 };
  for (const r of rows) counts[kind(r.provider)]++;
  const llm = await getLLMStatus(user.centerId);
  return ok({
    ...base,
    brain: { source: llm.source, model: llm.model ?? null },
    last7days: {
      tasks: rows.length,
      byBrain: counts,
      failed: rows.filter((r) => r.status === "FAILED").length,
      unmapped: rows.filter((r) => r.provider === "fallback").slice(0, 15).map((r) => ({ goal: r.goal.slice(0, 160), at: r.createdAt })),
    },
  });
});
