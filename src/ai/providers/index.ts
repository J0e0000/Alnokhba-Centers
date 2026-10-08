import "server-only";
import type { LLMProvider } from "./llm-provider";
import { ZaiProvider } from "./zai-provider";
import { OpenAICompatibleProvider } from "./openai-compatible";

/* ============================================================
   PROVIDER FACTORY — مصدر الحقيقة لاختيار الموديل (spec §1/§24)
   الأولوية:
   1) AGENT_LLM_BASE_URL + AGENT_LLM_MODEL → OpenAI-compatible (self-hosted/محلي)
   2) غير كده → ZAI المدمج (بيشتغل بدون أي إعداد)
   لو مفيش أي provider متاح → الوكيل يشتغل بالـ fallback الحتمي
   (orchestrator/fallback.ts) — نفس الأدوات، نفس الصلاحيات، نفس التأكيد.
============================================================ */

let cached: LLMProvider | null = null;
let probed = false;

export async function getLLM(): Promise<LLMProvider | null> {
  if (probed) return cached;
  probed = true;
  const baseUrl = process.env.AGENT_LLM_BASE_URL?.trim();
  const model = process.env.AGENT_LLM_MODEL?.trim();
  if (baseUrl && model) {
    cached = new OpenAICompatibleProvider(baseUrl, model, process.env.AGENT_LLM_API_KEY?.trim() ?? "");
    return cached;
  }
  const zai = new ZaiProvider();
  cached = (await zai.isAvailable()) ? zai : null;
  return cached;
}

/** للاختبار فقط — يلغي الكاش */
export function resetLLMCache(): void {
  cached = null;
  probed = false;
}
