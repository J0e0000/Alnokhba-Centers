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

  return ok({ ...status, brainFirst, commit, last7Days: split });
});
