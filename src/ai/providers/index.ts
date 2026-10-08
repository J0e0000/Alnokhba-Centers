import "server-only";
import type { LLMProvider } from "./llm-provider";
import { ZaiProvider } from "./zai-provider";
import { OpenAICompatibleProvider } from "./openai-compatible";
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

async function resolveLLM(centerId?: string): Promise<{ provider: LLMProvider | null; source: LLMSource }> {
  // 1) البيئة (الأعلى — لنشر self-hosted)
  const baseUrl = process.env.AGENT_LLM_BASE_URL?.trim();
  const model = process.env.AGENT_LLM_MODEL?.trim();
  if (baseUrl && model) {
    return {
      provider: new OpenAICompatibleProvider(baseUrl, model, process.env.AGENT_LLM_API_KEY?.trim() ?? ""),
      source: "env",
    };
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
