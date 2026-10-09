/* Smoke test: FailoverProvider chain + AnthropicProvider message conversion
   (no network needed — the Anthropic test runs only if ANTHROPIC_SMOKE_KEY is set) */
import { FailoverProvider } from "../src/ai/providers/failover-provider";
import { AnthropicProvider } from "../src/ai/providers/anthropic-provider";
import type { LLMProvider, LLMGenerateResult } from "../src/ai/providers/llm-provider";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function fake(name: string, behavior: "ok" | "throw", reply = `reply-from-${name}`): LLMProvider {
  return {
    name,
    model: `${name}-model`,
    isAvailable: async () => true,
    generate: async (): Promise<LLMGenerateResult> => {
      if (behavior === "throw") throw new Error(`${name}-blew-up`);
      return { text: reply, provider: name, model: `${name}-model`, usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

async function main() {
  // 1) أول موديل شغال يكسب
  const p1 = new FailoverProvider([fake("primary", "ok"), fake("backup", "ok")]);
  const r1 = await p1.generate([{ role: "user", content: "hi" }]);
  check("primary wins when healthy", r1.text === "reply-from-primary" && r1.provider === "primary");

  // 2) الأساسي بيفشل → الاحتياطي بيرد وبيتسجل هو
  const p2 = new FailoverProvider([fake("primary", "throw"), fake("backup", "ok")]);
  const r2 = await p2.generate([{ role: "user", content: "hi" }]);
  check("backup answers when primary fails", r2.text === "reply-from-backup" && r2.provider === "backup");

  // 3) الكل فاشل → رمي خطأ واضح (الفول باك الحتمي في الـ runner بيمسكه)
  const p3 = new FailoverProvider([fake("a", "throw"), fake("b", "throw")]);
  try {
    await p3.generate([{ role: "user", content: "hi" }]);
    check("all-failed throws", false);
  } catch (e) {
    // السلسلة بترمي آخر خطأ اتجرب (b) — ده الصحيح: خطأ آخر محاولة
    check("all-failed throws last error", e instanceof Error && e.message === "b-blew-up");
  }

  // 4) سلسلة فاضية مرفوضة وقت البناء
  try {
    new FailoverProvider([]);
    check("empty chain rejected", false);
  } catch {
    check("empty chain rejected", true);
  }

  // 5) تحويل رسايل Anthropic: system منفصل + دمج المتتالي + يبدأ بـ user
  const conv = AnthropicProvider.toAnthropicMessages([
    { role: "system", content: "S1" },
    { role: "system", content: "S2" },
    { role: "user", content: "u1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u3" },
  ]);
  check("system merged separately", conv.system === "S1\n\nS2");
  check("alternating roles", JSON.stringify(conv.messages.map((m) => m.role)) === '["user","assistant","user"]');
  check("same-role merged", conv.messages[0].content === "u1\n\nu2");
  check("order preserved", conv.messages[2].content === "u3");

  // 6) لما مفيش user أصلاً (ترانسكريبت شاذ) → بيحقن user بادئ
  const conv2 = AnthropicProvider.toAnthropicMessages([
    { role: "system", content: "S" },
    { role: "assistant", content: "a" },
  ]);
  check("injects leading user", conv2.messages[0].role === "user");

  // 7) isAvailable بتتبع السلسلة
  check("failover isAvailable reflects chain", await p2.isAvailable() === true);

  // 8) اختبار شبكي حقيقي اختياري (لو فيه مفتاح)
  if (process.env.ANTHROPIC_SMOKE_KEY) {
    const ap = new AnthropicProvider(
      process.env.ANTHROPIC_SMOKE_MODEL || "claude-3-5-haiku-latest",
      process.env.ANTHROPIC_SMOKE_KEY,
    );
    const ar = await ap.generate(
      [{ role: "system", content: "رد بكلمة واحدة فقط" }, { role: "user", content: "قل: تمام" }],
      { maxTokens: 30, temperature: 0 },
    );
    check("real anthropic call", ar.text.trim().length > 0, ar.text.slice(0, 30));
  } else {
    console.log("SKIP: real Anthropic call (no ANTHROPIC_SMOKE_KEY)");
  }

  console.log(failures === 0 ? "\nALL PROVIDER SMOKE CHECKS GREEN" : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
