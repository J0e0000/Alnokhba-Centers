import "server-only";
import type { LLMGenerateOptions, LLMGenerateResult, LLMMessage, LLMProvider } from "./llm-provider";

/* ============================================================
   ANTHROPIC PROVIDER — Claude عبر Messages API (من غير SDK)
   الإعداد من البيئة:
     AGENT_LLM_PROVIDER=anthropic
     AGENT_LLM_MODEL=<model id>        (مثال: claude-sonnet-5-5)
     AGENT_LLM_API_KEY=<مفتاح Anthropic>
     AGENT_LLM_BASE_URL (اختياري — الافتراضي https://api.anthropic.com)
   نفس عقد LLMProvider — الوكيل مبيعرفش الفرق.
============================================================ */

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(model: string, apiKey: string, baseUrl = "https://api.anthropic.com") {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async isAvailable(): Promise<boolean> {
    return !!this.model && !!this.apiKey;
  }

  /** Messages API بيشترط: system منفصل + أدوار بالتبادل تبدأ بـ user — بندمج المتتالي من نفس الدور */
  static toAnthropicMessages(messages: LLMMessage[]): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const out: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.content += `\n\n${m.content}`;
      else out.push({ role: m.role, content: m.content });
    }
    if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "(بداية المحادثة)" });
    return { system, messages: out };
  }

  async generate(messages: LLMMessage[], opts?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 60_000);
    try {
      const { system, messages: msgs } = AnthropicProvider.toAnthropicMessages(messages);
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: opts?.maxTokens ?? 1500,
          temperature: opts?.temperature ?? 0.2,
          ...(system ? { system } : {}),
          messages: msgs,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`anthropic-http-${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      if (!text) throw new Error("anthropic-empty-response");
      return {
        text,
        provider: this.name,
        model: this.model,
        usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
