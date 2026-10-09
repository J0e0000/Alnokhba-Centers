/* فحص سريع: GROQ_API_KEY لوحده كفاية عشان العقل يشتغل من غير AGENT_LLM_* ولا إعدادات سنتر */
process.env.GROQ_API_KEY = "gsk_test_fallback_probe";

async function main() {
  const { getLLMStatus, resetLLMCache } = await import("../src/ai/providers/index");
  resetLLMCache();
  const s = await getLLMStatus("__no_center__");
  console.log(JSON.stringify({ source: s.source, model: s.model }));
  if (s.source !== "env" || s.model !== "openai/gpt-oss-120b") {
    console.error("FAIL: expected env/openai/gpt-oss-120b");
    process.exit(1);
  }
  console.log("PASS: GROQ_API_KEY fallback → env / openai/gpt-oss-120b");
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
