import "server-only";
import type { LLMGenerateOptions, LLMGenerateResult, LLMMessage, LLMProvider } from "./llm-provider";

/* ============================================================
   ZAI PROVIDER — مزود GLM المدمج (بيشتغل بدون مفاتيح خارجية)
   ده الـ default في بيئة النشر الحالية. لو مش متاح، الـ factory
   بيستخدم OpenAI-compatible أو الـ fallback الحتمي.
============================================================ */

type ZaiChatMessage = { role: "system" | "user" | "assistant"; content: string };
type ZaiCompletion = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};
type ZaiClient = {
  chat: {
    completions: {
      create: (body: { messages: ZaiChatMessage[]; thinking?: { type: "enabled" | "disabled" } }) => Promise<ZaiCompletion>;
    };
  };
};

export class ZaiProvider implements LLMProvider {
  readonly name = "zai";
  readonly model = "glm-4.6";
  private cached: Promise<ZaiClient> | null = null;

  private client(): Promise<ZaiClient> {
    if (!this.cached) {
      this.cached = import("z-ai-web-dev-sdk").then(
        (mod) => mod.default.create() as unknown as Promise<ZaiClient>,
      );
    }
    return this.cached;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client();
      return true;
    } catch {
      return false;
    }
  }

  async generate(messages: LLMMessage[], opts?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const zai = await this.client();
    const completion = await zai.chat.completions.create({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: "disabled" },
    });
    const text = completion.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("zai-empty-response");
    return {
      text,
      provider: this.name,
      model: this.model,
      usage: completion.usage
        ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens }
        : undefined,
    };
  }
}
