// make_queue.mjs — build a stratified priority queue so limited quota yields representative coverage
// Target: 12 tasks per domain × 20 domains = 240, split-proportional (dev 70% / val 16% / holdout 14%),
// difficulty-balanced. Tasks already completed (any status) in baseline-v1 are excluded.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'fs';

const db = new DatabaseSync('/home/z/my-project/benchmark/benchmark.db');
const RUN_ID = 'baseline-v1';
const PER_DOMAIN = 12;

function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(20261016);

const already = new Set(db.prepare('SELECT task_id FROM results WHERE run_id=?').all(RUN_ID).map(r => r.task_id));
const tasks = db.prepare('SELECT task_id, domain, split, difficulty FROM tasks ORDER BY task_id').all().filter(t => !already.has(t.task_id));

const byDomain = {};
for (const t of tasks) (byDomain[t.domain] ??= []).push(t);

const SPLIT_QUOTA = { 'Improve/Development': 0.70, 'Validation': 0.16, 'Holdout/Regression': 0.14 };
const queue = [];
let devN = 0, valN = 0, holdN = 0;

for (const [domain, list] of Object.entries(byDomain)) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  // per-split quotas for this domain, difficulty-balanced inside each split
  const picked = [];
  const used = new Set();
  for (const [split, frac] of Object.entries(SPLIT_QUOTA)) {
    const want = Math.round(PER_DOMAIN * frac);
    const pool = list.filter(t => t.split === split && !used.has(t.task_id));
    const difOrder = ['Easy', 'Medium', 'Hard', 'Expert'];
    for (const dif of difOrder) {
      for (const t of pool.filter(t => t.difficulty === dif)) {
        if (picked.filter(p => p.split === split).length >= want) break;
        if (!used.has(t.task_id)) { picked.push(t); used.add(t.task_id); }
      }
      if (picked.filter(p => p.split === split).length >= want) break;
    }
  }
  // fill up to PER_DOMAIN from leftovers (any split/difficulty)
  for (const t of list) { if (picked.length >= PER_DOMAIN) break; if (!used.has(t.task_id)) { picked.push(t); used.add(t.task_id); } }
  for (const p of picked) queue.push(p.task_id);
  devN += picked.filter(p => p.split === 'Improve/Development').length;
  valN += picked.filter(p => p.split === 'Validation').length;
  holdN += picked.filter(p => p.split === 'Holdout/Regression').length;
}

writeFileSync('/home/z/my-project/benchmark/queue_priority.txt', queue.join('\n') + '\n');
console.log(`stratified queue: ${queue.length} tasks (dev=${devN} val=${valN} holdout=${holdN})`);
db.close();
