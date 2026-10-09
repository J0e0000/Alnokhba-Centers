// Smoke test: Groq key + model availability + JSON mode (the exact mode Zaki uses)
// Usage: node scripts/test_groq_smoke.mjs <GROQ_KEY>
const KEY = process.argv[2] || "";
if (!KEY) { console.error("no key"); process.exit(1); }
const BASE = "https://api.groq.com/openai/v1";

async function main() {
  // 1) list models available to this account
  const mr = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  console.log("models.status =", mr.status);
  if (!mr.ok) { console.log(await mr.text()); process.exit(2); }
  const mj = await mr.json();
  const ids = (mj.data || []).map((m) => m.id).filter((id) => !/whisper|tts|guard|embed/i.test(id));
  console.log("chat models:", ids.join(", "));

  // 2) prefer gpt-oss-120b (recipe), then llama-3.3-70b, then qwen3-32b
  const pref = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-20b"];
  const model = pref.find((p) => ids.includes(p)) || ids[0];
  console.log("chosen model =", model);

  // 3) JSON-mode completion with an agent-style protocol prompt (like src/ai/prompts/system.ts)
  const sys = 'أنت زكي، مساعد إدارة سنتر دراسي. أعد ALWAYS كائن JSON واحد فقط بالصيغة: {"type":"answer","text":"..."} — بدون أي نص خارج JSON.';
  const user = "عندنا إيه النهاردة من حصص؟ (تظاهر أنك سألت أداة dashboard.get_today ورجعت 5 حصص)";
  const t0 = Date.now();
  const cr = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });
  console.log("chat.status =", cr.status, "in", Date.now() - t0, "ms");
  const cj = await cr.json();
  if (!cr.ok) { console.log(JSON.stringify(cj).slice(0, 800)); process.exit(3); }
  const msg = cj.choices?.[0]?.message;
  console.log("usage:", JSON.stringify(cj.usage));
  console.log("has reasoning field:", !!msg?.reasoning, "| reasoning chars:", (msg?.reasoning || "").length);
  console.log("content:", (msg?.content || "").slice(0, 400));
  try { const p = JSON.parse(msg?.content || ""); console.log("JSON.parse ✓ type =", p.type); }
  catch (e) { console.log("JSON.parse ✗", e.message); }
}
main().catch((e) => { console.error("FATAL", e.message); process.exit(9); });
