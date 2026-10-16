// run_bank.mjs — Phase 1/2: resumable baseline runner against the TARGET (glm-4-plus via SDK)
// Rules honored from the master prompt:
//  - Only the Task Prompt is sent to the target (never acceptance criteria / answer keys)
//  - Batches of 25 logged; concurrency within batch; retries w/ backoff; redacted errors
//  - Resumable: existing (run_id, task_id) pairs are skipped
//  - Logs model, latency, tokens, raw response
import { DatabaseSync } from 'node:sqlite';
import ZAI from 'z-ai-web-dev-sdk';
import { writeFileSync, appendFileSync, readFileSync } from 'fs';

const DB_PATH = '/home/z/my-project/benchmark/benchmark.db';
const db = new DatabaseSync(DB_PATH);

// ---- CLI ----
const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
const RUN_ID = arg('--run-id', 'baseline-v1');
const KIND = arg('--kind', 'baseline');
const CONFIG = arg('--config', 'sysprompt-v1');
const SYSTEM_PROMPT = arg('--system', 'You are a helpful assistant. Answer precisely and concisely.');
const BATCH = parseInt(arg('--batch', '25'), 10);
const CONC = parseInt(arg('--concurrency', '2'), 10);
const GAP = parseInt(arg('--gap', '500'), 10); // ms between request launches
const LIMIT = parseInt(arg('--limit', '0'), 10); // 0 = no limit
const ONLY_FILE = arg('--only-file', ''); // file with one task id per line
const QUEUE_FILE = arg('--queue-file', ''); // priority order: process pending tasks in this order first
const SPLITS = arg('--splits', ''); // comma list filter

// register run
db.prepare(`INSERT OR IGNORE INTO runs (run_id, kind, config_version, system_prompt, model, started_at, notes)
  VALUES (?,?,?,?,?,?,?)`)
  .run(RUN_ID, KIND, CONFIG, SYSTEM_PROMPT, 'glm-4-plus', new Date().toISOString(), `batch=${BATCH} conc=${CONC}`);

// select pending tasks
let tasks = db.prepare('SELECT task_id, task_prompt, split FROM tasks ORDER BY task_id').all();
const done = new Set(db.prepare('SELECT task_id FROM results WHERE run_id = ? AND status = ?').all(RUN_ID, 'ok').map(r => r.task_id));
tasks = tasks.filter(t => !done.has(t.task_id));
if (SPLITS) { const s = new Set(SPLITS.split(',')); tasks = tasks.filter(t => s.has(t.split)); }
if (ONLY_FILE) {
  const ids = new Set(readFileSync(ONLY_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
  tasks = tasks.filter(t => ids.has(t.task_id));
}
if (QUEUE_FILE) {
  // order pending tasks by priority queue (stratified subset first), then any remaining
  const prio = readFileSync(QUEUE_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const prioSet = new Map(prio.map((id, i) => [id, i]));
  tasks.sort((a, b) => (prioSet.has(a.task_id) ? prioSet.get(a.task_id) : 1e9) - (prioSet.has(b.task_id) ? prioSet.get(b.task_id) : 1e9));
}
if (LIMIT > 0) tasks = tasks.slice(0, LIMIT);

console.log(`run=${RUN_ID} config=${CONFIG} pending=${tasks.length} (already ok: ${done.size})`);
const LOG = `/home/z/my-project/benchmark/log_${RUN_ID}.txt`;
appendFileSync(LOG, `\n==== run ${RUN_ID} started ${new Date().toISOString()} pending=${tasks.length} ====\n`);

const zai = await ZAI.create();
const insResult = db.prepare(`INSERT OR REPLACE INTO results
  (run_id, task_id, status, raw_response, latency_ms, prompt_tokens, completion_tokens, error_redacted, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);

let okCount = 0, errCount = 0, tokenSum = 0;
// global pause: any 429 pauses ALL launches for a while (prevents retry storms)
let pauseUntil = 0;
// AIMD adaptive gap: find sustainable rate automatically
let gapMs = parseInt(arg('--gap', '2000'), 10);
const GAP_MIN = 1200, GAP_MAX = 10000;
let okStreak = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTarget(taskId, prompt) {
  const t0 = Date.now();
  const backoffs = [3000, 8000, 15000, 30000, 60000]; // 429-aware: 6 attempts total
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    // respect global pause window before every attempt
    while (Date.now() < pauseUntil) await sleep(Math.min(pauseUntil - Date.now(), 5000));
    try {
      // hard per-call timeout — a hanging SDK call must not stall the whole run
      const completion = await Promise.race([
        zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          thinking: { type: 'disabled' },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CALL_TIMEOUT_90S')), 90000)),
      ]);
      const content = completion.choices?.[0]?.message?.content;
      if (!content || !String(content).trim()) throw new Error('EMPTY_RESPONSE');
      // additive increase on success (every 10 OKs, shrink gap 8%)
      if (++okStreak % 10 === 0) gapMs = Math.max(GAP_MIN, Math.round(gapMs * 0.92));
      return {
        status: 'ok',
        raw_response: String(content),
        latency_ms: Date.now() - t0,
        prompt_tokens: completion.usage?.prompt_tokens ?? null,
        completion_tokens: completion.usage?.completion_tokens ?? null,
        error_redacted: null,
      };
    } catch (e) {
      const msg = String(e?.message ?? e);
      const redacted = msg.replace(/sk-\S+/g, 'sk-REDACTED').replace(/Bearer\s+\S+/gi, 'Bearer REDACTED').slice(0, 200);
      const is429 = /429|too many/i.test(msg);
      if (is429) {
        // multiplicative decrease + global cooldown (45s)
        gapMs = Math.min(GAP_MAX, Math.round(gapMs * 1.6));
        okStreak = 0;
        pauseUntil = Math.max(pauseUntil, Date.now() + 45000);
      }
      if (attempt === backoffs.length) return { status: 'error', raw_response: null, latency_ms: Date.now() - t0, prompt_tokens: null, completion_tokens: null, error_redacted: redacted };
      await sleep(is429 ? backoffs[attempt] : 1000);
    }
  }
}

async function runBatch(batch, batchNo) {
  // paced launch: concurrency N with gapMs between launches (429-friendly)
  // per-task persistence: each result is written to SQLite immediately on completion
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONC, batch.length) }, async () => {
    while (idx < batch.length) {
      const my = idx++;
      if (my > 0 && gapMs > 0) await sleep(gapMs);
      const t = batch[my];
      const r = await callTarget(t.task_id, t.task_prompt);
      insResult.run(RUN_ID, t.task_id, r.status, r.raw_response, r.latency_ms, r.prompt_tokens, r.completion_tokens, r.error_redacted, new Date().toISOString());
      if (r.status === 'ok') { okCount++; tokenSum += (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0); }
      else errCount++;
      console.log(`  ${t.task_id}: ${r.status} ${r.latency_ms}ms${r.status === 'error' ? ' ERR=' + (r.error_redacted ?? '').slice(0, 80) : ''}`);
      appendFileSync(LOG, `${t.task_id}: ${r.status}\n`);
    }
  });
  await Promise.all(workers);
  console.log(`batch ${batchNo}: done (session ok=${okCount} err=${errCount})`);
  appendFileSync(LOG, `batch ${batchNo}: done\n`);
}

const totalBatches = Math.ceil(tasks.length / BATCH);
for (let i = 0; i < tasks.length; i += BATCH) {
  await runBatch(tasks.slice(i, i + BATCH), i / BATCH + 1);
  // durability: periodic full sync is implicit (node:sqlite writes synchronously)
}

db.prepare(`UPDATE runs SET finished_at = ? WHERE run_id = ? AND finished_at IS NULL`).run(new Date().toISOString(), RUN_ID);
const done2 = db.prepare('SELECT COUNT(*) c FROM results WHERE run_id=? AND status=?').get(RUN_ID, 'ok').c;
console.log(`\nDONE run=${RUN_ID}: cumulative ok=${done2}/1000, errors_this_session=${errCount}, tokens_this_session=${tokenSum}`);
db.close();
