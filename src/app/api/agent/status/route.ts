import { handler, ok } from "@/lib/api";
import { requireManager, rateLimit } from "@/lib/auth";
import { getLLMStatus } from "@/ai/providers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/agent/status — حالة عقل زكي (manager، بدون أي مفاتيح)
   بيرجع: مصدر الموديل النشط (env|center|builtin|fallback) + اسمه
   + ترتيب العقول الحالي (الموديل الأول ولا المخ الأول)
   + توزيع المهمام الأخيرة على العقول (llm/brain/fallback) لآخر 7 أيام —
   عشان المدير يشوف العقل اللي بيشغل زكي فعلًا بالأرقام.
============================================================ */

export const GET = handler(async () => {
  const user = await requireManager();
  rateLimit(`agent-status:${user.id}`, 30, 60_000);

  const status = await getLLMStatus(user.centerId);
  const brainFirst = process.env.NK_AGENT_BRAIN_FIRST === "1";
  // علامة النسخة المنشورة — بتأكد إن آخر بوش وصل فعلًا للإنتاج (وبيساعد في تشخيص الـ deploys)
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

  // توزيع المهمام على العقول — من تدقيق المهام نفسه (provider مخزّن لكل مهمة)
  let split: { provider: string; tasks: number }[] = [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db.agentTask.groupBy({
      by: ["provider"],
      where: { centerId: user.centerId, createdAt: { gte: since } },
      _count: true,
    });
    split = rows
      .map((r) => ({ provider: r.provider ?? "unknown", tasks: r._count }))
      .sort((a, b) => b.tasks - a.tasks);
  } catch {
    // جدول ناقص في بيئة قديمة — الحالة الأساسية تكفي
  }

  // استهلاك الموديل (§9) + تقييمات المستخدمين (§8) — أرقام حقيقية للمدير
  let usage: { turns: number; inputTokens: number; outputTokens: number; avgLatencyMs: number | null } | null = null;
  let feedback: { up: number; down: number } | null = null;
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const agg = await db.agentUsage.aggregate({
      where: { centerId: user.centerId, kind: "llm_turn", createdAt: { gte: since } },
      _count: true, _sum: { inputTokens: true, outputTokens: true }, _avg: { latencyMs: true },
    });
    usage = {
      turns: agg._count,
      inputTokens: agg._sum.inputTokens ?? 0,
      outputTokens: agg._sum.outputTokens ?? 0,
      avgLatencyMs: agg._avg.latencyMs != null ? Math.round(agg._avg.latencyMs) : null,
    };
    const fb = await db.agentMessage.groupBy({
      by: ["feedback"],
      where: { feedback: { not: null }, createdAt: { gte: since }, task: { centerId: user.centerId } },
      _count: true,
    });
    feedback = {
      up: fb.find((r) => r.feedback === "UP")?._count ?? 0,
      down: fb.find((r) => r.feedback === "DOWN")?._count ?? 0,
    };
  } catch {
    // بيئة من غير الجداول الجديدة — الحالة الأساسية تكفي
  }

  return ok({ ...status, brainFirst, commit, last7Days: split, usage, feedback });
});
