import "server-only";
import type { LLMGenerateOptions, LLMGenerateResult, LLMMessage, LLMProvider } from "./llm-provider";

/* ============================================================
   OPENAI-COMPATIBLE PROVIDER — أي endpoint متوافق مع OpenAI API
   (self-hosted / vLLM / Ollama / OpenAI / غيرهم) من غير ما نغير
   سطر واحد في الوكيل (spec §24).
   الإعداد من البيئة:
     AGENT_LLM_BASE_URL  (مثال: https://my-host/v1)
     AGENT_LLM_API_KEY   (لو محتاج — self-hosted ممكن من غير مفتاح)
     AGENT_LLM_MODEL     (مثال: qwen2.5-14b-instruct)
============================================================ */

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, model: string, apiKey = "") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.baseUrl && !!this.model;
  }

  async generate(messages: LLMMessage[], opts?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 60_000);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: opts?.temperature ?? 0.2,
          max_tokens: opts?.maxTokens ?? 1500,
        }),
      });
      if (!res.ok) throw new Error(`llm-http-${res.status}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("llm-empty-response");
      return {
        text,
        provider: this.name,
        model: this.model,
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
