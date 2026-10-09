import "server-only";
import type { LLMGenerateOptions, LLMGenerateResult, LLMMessage, LLMProvider } from "./llm-provider";

/* ============================================================
   FAILOVER PROVIDER — أول موديل بيرد بنجاح يكسب.
   لو الأساسي وقع (timeout / 5xx / rate-limit) بنجرب اللي بعده بدل
   ما المستخدم يشوف عطل. الموديل اللي جاوب هو اللي بيتسجل في النتيجة.
============================================================ */

export class FailoverProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly chain: LLMProvider[]) {
    if (!chain.length) throw new Error("failover-empty-chain");
    this.name = chain[0].name;
    this.model = chain[0].model;
  }

  async isAvailable(): Promise<boolean> {
    for (const p of this.chain) if (await p.isAvailable()) return true;
    return false;
  }

  async generate(messages: LLMMessage[], opts?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    let lastErr: unknown;
    for (const p of this.chain) {
      try {
        if (!(await p.isAvailable())) continue;
        return await p.generate(messages, opts);
      } catch (e) {
        lastErr = e;
        console.error(`[agent] provider ${p.name}:${p.model} failed, trying next:`, e instanceof Error ? e.message : e);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("failover-all-providers-failed");
  }
}
