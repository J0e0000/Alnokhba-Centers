// init_db.mjs — Phase 1 HARNESS: create benchmark DB + import the 1,000-task bank
// Store: node:sqlite (built-in). Resumable, no duplicates via UNIQUE(run_id, task_id).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';

const DB_PATH = '/home/z/my-project/benchmark/benchmark.db';
const CSV_PATH = '/home/z/my-project/upload/AI_Improvement_1000_Task_Bank.csv';

const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- baseline | retest-dev | retest-validation | retest-holdout
  config_version TEXT NOT NULL,      -- sysprompt-v1 | sysprompt-v2 ...
  system_prompt TEXT NOT NULL,
  model TEXT,
  started_at TEXT,
  finished_at TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS results (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- ok | error
  raw_response TEXT,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_redacted TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, task_id)
);
CREATE TABLE IF NOT EXISTS scores (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  score INTEGER,                     -- 0-100 (NULL = pending rubric)
  method TEXT,                       -- deterministic | rubric | hybrid
  dimensions TEXT,                   -- JSON {correctness, instruction, completeness, reasoning, safety} 0-5 or null
  checks_total INTEGER,
  checks_passed INTEGER,
  confidence REAL,
  error_class TEXT,
  root_cause TEXT,
  judge_notes TEXT,
  scored_at TEXT,
  PRIMARY KEY (run_id, task_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  domain TEXT, subskill TEXT, test_type TEXT, difficulty TEXT,
  split TEXT, target_type TEXT,
  task_prompt TEXT,
  acceptance TEXT,
  eval_method TEXT, tool_req TEXT
);
`);

// import tasks (idempotent)
const csv = readFileSync(CSV_PATH, 'utf8');
// minimal CSV parser handling quoted fields with embedded commas/newlines/quotes
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
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
const rows = parseCSV(csv.replace(/^\uFEFF/, ''));
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const ins = db.prepare(`INSERT OR IGNORE INTO tasks
  (task_id, domain, subskill, test_type, difficulty, split, target_type, task_prompt, acceptance, eval_method, tool_req)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
let n = 0;
for (const r of rows.slice(1)) {
  if (!r[idx['Task ID']]) continue;
  ins.run(r[idx['Task ID']], r[idx['Domain']], r[idx['Subskill']], r[idx['Test Type']],
    r[idx['Difficulty']], r[idx['Split']], r[idx['Target Type']],
    r[idx['Task Prompt']], r[idx['Expected Outcome / Acceptance Criteria']],
    r[idx['Evaluation Method']], r[idx['Tool Requirement']]);
  n++;
}
const cnt = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
console.log(`imported ${n} new, tasks total = ${cnt}`);
db.close();
