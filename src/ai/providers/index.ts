import "server-only";
import type { LLMProvider } from "./llm-provider";
import { ZaiProvider } from "./zai-provider";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { AnthropicProvider } from "./anthropic-provider";
import { FailoverProvider } from "./failover-provider";
import { db } from "@/lib/db";

/* ============================================================
   PROVIDER FACTORY — مصدر الحقيقة لاختيار الموديل (spec §1/§24)
   الأولوية:
   1) متغيرات البيئة AGENT_LLM_BASE_URL + AGENT_LLM_MODEL (للنشر الذاتي)
   2) إعداد السنتر من شاشة الإعدادات (OpenAI-compatible — أي موديل)
   3) ZAI المدمج (بيئة النشر الحالية لو متاح)
   4) مفيش → المخ الحتمي المدمج (orchestrator/fallback.ts) —
      نفس الأدوات، نفس الصلاحيات، نفس التأكيد.
   المفتاح بيتخزن سيرفري في الداتابيز ومش بيرجع للعميل أبدًا.
============================================================ */

type CacheEntry = { provider: LLMProvider | null; source: LLMSource; expires: number };
export type LLMSource = "env" | "center" | "builtin" | "fallback";

const TTL_MS = 30_000; // إعدادات السنتر بتتقري مرة كل 30 ثانية — التغيير من الإعدادات بيتشاف فورًا تقريبًا
const cache = new Map<string, CacheEntry>();

export async function getLLM(centerId?: string): Promise<LLMProvider | null> {
  const key = centerId ?? "__global__";
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.provider;

  const resolved = await resolveLLM(centerId);
  cache.set(key, { ...resolved, expires: Date.now() + TTL_MS });
  return resolved.provider;
}

/** يبني موديل من متغيرات بيئة بالبادئة دي: <P>_PROVIDER (anthropic | openai-compatible) + _MODEL + _API_KEY + _BASE_URL */
function providerFromEnv(prefix: string): LLMProvider | null {
  const env = (k: string) => process.env[`${prefix}_${k}`]?.trim() ?? "";
  const kind = env("PROVIDER").toLowerCase();
  const model = env("MODEL");
  const baseUrl = env("BASE_URL");
  const apiKey = env("API_KEY");
  if (kind === "anthropic") {
    return model && apiKey ? new AnthropicProvider(model, apiKey, baseUrl || undefined) : null;
  }
  // الافتراضي: OpenAI-compatible (السلوك القديم بالظبط لما PROVIDER مش متحدد)
  return baseUrl && model ? new OpenAICompatibleProvider(baseUrl, model, apiKey) : null;
}

async function resolveLLM(centerId?: string): Promise<{ provider: LLMProvider | null; source: LLMSource }> {
  // 1) البيئة (الأعلى — لنشر self-hosted أو موديل خارجي) + اختياري موديل احتياطي (failover)
  const primary = providerFromEnv("AGENT_LLM");
  if (primary) {
    const backup = providerFromEnv("AGENT_LLM_FALLBACK");
    return { provider: backup ? new FailoverProvider([primary, backup]) : primary, source: "env" };
  }

  // 2) إعداد السنتر من شاشة الإعدادات (المدير بيوصل أي موديل متوافق مع OpenAI)
  if (centerId) {
    try {
      const center = await db.center.findUnique({
        where: { id: centerId },
        select: { agentLlmBaseUrl: true, agentLlmModel: true, agentLlmApiKey: true },
      });
      if (center?.agentLlmBaseUrl?.trim() && center?.agentLlmModel?.trim()) {
        return {
          provider: new OpenAICompatibleProvider(
            center.agentLlmBaseUrl.trim(),
            center.agentLlmModel.trim(),
            center.agentLlmApiKey?.trim() ?? "",
          ),
          source: "center",
        };
      }
    } catch {
      // جدول/عمود ناقص — نكمل للـ builtin بدل ما نكسر الوكيل
    }
  }

  // 3) ZAI المدمج
  const zai = new ZaiProvider();
  if (await zai.isAvailable()) return { provider: zai, source: "builtin" };

  return { provider: null, source: "fallback" };
}

/** حالة العقل الحالية — لعرضها في الإعدادات (من غير أي مفاتيح) */
export async function getLLMStatus(centerId: string): Promise<{ source: LLMSource; model?: string }> {
  const key = centerId;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return { source: hit.source, model: hit.provider?.model };
  }
  const resolved = await resolveLLM(centerId);
  cache.set(key, { ...resolved, expires: Date.now() + TTL_MS });
  return { source: resolved.source, model: resolved.provider?.model };
}

/** للاختبار/بعد حفظ الإعدادات — يلغي الكاش */
export function resetLLMCache(): void {
  cache.clear();
}
