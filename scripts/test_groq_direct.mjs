// Direct chat test bypassing /models
const KEY = process.argv[2] || "";
const BASE = "https://api.groq.com/openai/v1";
const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "moonshotai/kimi-k2-instruct-0905", "gemma2-9b-it"];

async function tryChat(model) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "قل: تمام" }],
      max_tokens: 500,
    }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(model, "->", r.status, r.ok ? "OK ✓" : (j?.error?.message || "").slice(0, 160));
  return r.ok;
}

for (const m of models) { if (await tryChat(m)) break; }
