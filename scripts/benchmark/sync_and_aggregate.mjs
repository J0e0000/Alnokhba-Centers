// sync_and_aggregate.mjs — fills the CSV workbook from the DB + prints aggregate stats
// Workbook = the user's original 1000-task bank with result columns filled (resumable pipeline output)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = '/home/z/my-project/benchmark/benchmark.db';
const CSV_PATH = '/home/z/my-project/upload/AI_Improvement_1000_Task_Bank.csv';
const OUT_PATH = process.argv[2] || '/home/z/my-project/benchmark/AI_Improvement_1000_Task_Bank_SCORED.csv';
const RUN_ID = process.argv[3] || 'baseline-v1';

const db = new DatabaseSync(DB_PATH);

// ---------- CSV parse (same minimal parser as init_db) ----------
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function toCSV(rows) {
  return rows.map(r => r.map(f => {
    const s = f ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n') + '\n';
}

const rows = parseCSV(readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, ''));
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

// ---------- load data ----------
const tasks = {};
for (const t of db.prepare('SELECT * FROM tasks').all()) tasks[t.task_id] = t;
const results = {};
for (const r of db.prepare('SELECT * FROM results WHERE run_id=?').all(RUN_ID)) results[r.task_id] = r;
const scores = {};
for (const s of db.prepare('SELECT * FROM scores WHERE run_id=?').all(RUN_ID)) scores[s.task_id] = s;

// ---------- fill workbook ----------
let filled = 0, pendingRubric = 0;
for (let i = 1; i < rows.length; i++) {
  const tid = rows[i][idx['Task ID']];
  if (!tid || !tasks[tid]) continue;
  const r = results[tid], s = scores[tid];
  if (r && r.status === 'ok') {
    rows[i][idx['Baseline Response']] = r.raw_response ?? '';
    filled++;
  } else if (r && r.status === 'error') {
    rows[i][idx['Baseline Response']] = `[RUNNER_ERROR: ${r.error_redacted ?? 'unknown'}]`;
  }
  if (s && s.score !== null && s.score !== undefined) {
    rows[i][idx['Baseline Score (0-100)']] = String(s.score);
    rows[i][idx['Error Class']] = s.error_class ?? '';
    rows[i][idx['Root Cause']] = s.root_cause ?? '';
    rows[i][idx['Judge Confidence (0-1)']] = s.confidence !== null ? String(s.confidence) : '';
    rows[i][idx['Status']] = 'Scored';
    rows[i][idx['Reviewer Notes']] = (s.method === 'rubric' ? `[rubric] ` : `[deterministic] `) + (s.judge_notes ?? '');
  } else if (r && r.status === 'ok') {
    rows[i][idx['Status']] = 'RunPendingRubric';
    pendingRubric++;
  } else {
    rows[i][idx['Status']] = 'Not Run';
  }
}
writeFileSync(OUT_PATH, toCSV(rows));
console.log(`workbook written: ${OUT_PATH} | responses filled=${filled} | run-pending-rubric=${pendingRubric}`);

// ---------- aggregates ----------
const scored = Object.entries(scores).filter(([, s]) => s.score !== null && s.score !== undefined);
const overall = scored.length ? (scored.reduce((a, [, s]) => a + s.score, 0) / scored.length) : 0;
const bands = { PASS: 0, REVIEW: 0, FAIL: 0 };
for (const [, s] of scored) { if (s.score >= 85) bands.PASS++; else if (s.score >= 70) bands.REVIEW++; else bands.FAIL++; }

const byDomain = {};
for (const [tid, s] of scored) {
  const d = tasks[tid]?.domain ?? '?';
  (byDomain[d] ??= []).push(s.score);
}
console.log(`\n=== AGGREGATE (run=${RUN_ID}) ===`);
console.log(`scored=${scored.length}/1000 | mean=${overall.toFixed(1)} | PASS(>=85)=${bands.PASS} REVIEW(70-84)=${bands.REVIEW} FAIL(<70)=${bands.FAIL}`);
console.log('--- by domain (scored only) ---');
for (const [d, arr] of Object.entries(byDomain).sort()) {
  console.log(`${d}: n=${arr.length} mean=${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)}`);
}
const errHist = {};
for (const [, s] of scored) if (s.error_class) errHist[s.error_class] = (errHist[s.error_class] || 0) + 1;
console.log('--- error classes ---', JSON.stringify(errHist));
const runs = db.prepare('SELECT * FROM runs WHERE run_id=?').get(RUN_ID);
const lat = db.prepare('SELECT AVG(latency_ms) a, SUM(prompt_tokens) p, SUM(completion_tokens) c FROM results WHERE run_id=? AND status=?').get(RUN_ID, 'ok');
console.log(`--- run meta ---`);
console.log(`model=${runs?.model} config=${runs?.config_version} started=${runs?.started_at} avg_latency=${Math.round(lat.a ?? 0)}ms tokens(prompt=${lat.p ?? 0}, completion=${lat.c ?? 0})`);
db.close();
