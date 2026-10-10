import "server-only";
import { db } from "@/lib/db";

/* ============================================================
   USAGE & BUDGET — قياس استهلاك الوكيل + ميزانية لكل سنتر (spec §9)
   - كل نداء LLM فعلي بيتسجل بتوكِناته من تقرير المزود نفسه (مش تقدير)
   - المخ الحتمي (regex) مجاني ومش بيتسجل — التسجيل للموديل بس
   - الميزانية: سقف نداءات/يوم و/شهر لكل سنتر (env قابل للضبط) —
     لما الحد يوصل: الموديل بيتقفل والمخ الحتمي بيكمّل (النظام الأساسي
     غير الذكي بيفضل شغال — AI optional بالظبط)
   - الفشل في التسجيل عمره ما يكسر المهمة (أفضل جهد)
============================================================ */

const DAILY_TURNS = Number(process.env.NK_AGENT_DAILY_TURNS ?? 1500);
const MONTHLY_TURNS = Number(process.env.NK_AGENT_MONTHLY_TURNS ?? 15000);

function startOfUTC(now: Date, unit: "day" | "month"): Date {
  const d = new Date(now);
  if (unit === "month") d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** حالة الميزانية الحالية للسنتر — عمليتا COUNT مفهرسة، رخيصة */
export async function getBudgetState(centerId: string): Promise<{
  exceeded: boolean;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
}> {
  const now = new Date();
  const [daily, monthly] = await Promise.all([
    db.agentUsage.count({ where: { centerId, kind: "llm_turn", createdAt: { gte: startOfUTC(now, "day") } } }),
    db.agentUsage.count({ where: { centerId, kind: "llm_turn", createdAt: { gte: startOfUTC(now, "month") } } }),
  ]);
  return {
    exceeded: daily >= DAILY_TURNS || monthly >= MONTHLY_TURNS,
    dailyUsed: daily,
    dailyLimit: DAILY_TURNS,
    monthlyUsed: monthly,
    monthlyLimit: MONTHLY_TURNS,
  };
}

/** تسجيل نداء LLM — بيتنادى بعد كل generate ناجح (حتى لو الرد خرق البروتوكول،
 *  التوكِنات اتحرقت فعلًا فلازم تتحسب). أفضل جهد: أي فشل يتسجل في اللوج ويمضي. */
export async function persistLlmUsage(opts: {
  centerId: string;
  userId: string;
  taskId: string;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  attempt: number;
}): Promise<void> {
  try {
    await db.agentUsage.create({
      data: {
        centerId: opts.centerId,
        userId: opts.userId,
        taskId: opts.taskId,
        kind: "llm_turn",
        provider: opts.provider,
        model: opts.model,
        inputTokens: opts.usage?.inputTokens ?? null,
        outputTokens: opts.usage?.outputTokens ?? null,
        latencyMs: Math.min(opts.latencyMs, 2_147_483_647),
        attempt: opts.attempt,
      },
    });
  } catch (e) {
    // قاعدة قديمة من غير جدول الاستهلاك — اللوج يكفي، المهمة مستمرة
    console.error("[agent:usage] persist failed:", e instanceof Error ? e.message : e);
  }
}
