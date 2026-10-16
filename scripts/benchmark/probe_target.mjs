// probe_target.mjs — Phase 0 DISCOVER: prove the TARGET_SYSTEM invocation path works
// Target: z-ai-web-dev-sdk v0.0.18 (GLM) — separate system from the orchestrator (me)
import ZAI from 'z-ai-web-dev-sdk';
import { writeFileSync } from 'fs';

const t0 = Date.now();
try {
  const zai = await ZAI.create();
  const t1 = Date.now();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: 'You are a helpful assistant. Answer precisely and concisely.' },
      { role: 'user', content: 'What is 17 * 23? Reply with the number only.' },
    ],
    thinking: { type: 'disabled' },
  });
  const t2 = Date.now();
  const answer = completion.choices[0]?.message?.content ?? '';
  const result = {
    ok: true,
    sdk_version: '0.0.18',
    init_ms: t1 - t0,
    call_ms: t2 - t1,
    answer: String(answer).trim(),
    deterministic_check: String(answer).trim().includes('391') ? 'PASS (17*23=391)' : 'FAIL',
    model_meta: completion.model ?? completion.choices?.[0]?.model ?? 'not-exposed',
    usage: completion.usage ?? 'not-exposed',
    keys: Object.keys(completion ?? {}),
  };
  console.log(JSON.stringify(result, null, 2));
  writeFileSync('/home/z/my-project/scripts/benchmark/probe_result.json', JSON.stringify(result, null, 2));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 400) }, null, 2));
  process.exit(1);
}
