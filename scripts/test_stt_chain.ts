/**
 * اختبار سلسلة مزودي STT — Groq (لو فيه مفتاح) ← ZAI
 * Run: set -a; source .env; set +a; NODE_OPTIONS="--conditions=react-server" npx tsx scripts/test_stt_chain.ts [wavPath]
 * مع AGENT_STT_API_KEY: لازم Groq يتجرب الأول (وهفشل هنا بالبلوك الجغرافي) وبعدها ZAI — والنص يرجع برضه
 * من غير مفتاح: ZAI على طول
 */
import fs from "fs";
import { transcribeAudio } from "../src/ai/providers/stt";

async function main() {
  const wav = process.argv[2] ?? "/tmp/zk_16k.wav";
  const b64 = fs.readFileSync(wav).toString("base64");
  console.log("key configured:", !!process.env.AGENT_STT_API_KEY);
  const t0 = Date.now();
  const r = await transcribeAudio(b64, "audio/wav", "cmufick570003iqo9fnqvrh2c");
  console.log(`result in ${Date.now() - t0}ms → provider=${r.provider} model=${r.model} text="${r.text.slice(0, 80)}"`);
}
main().catch((e) => { console.error("💥", e instanceof Error ? e.message : e); process.exit(1); });
