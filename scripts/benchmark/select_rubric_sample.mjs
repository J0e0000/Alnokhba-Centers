// select_rubric_sample.mjs — pick a stratified judge sample (me, independent of target)
// Stratification: 20 domains × difficulty × split, seeded shuffle for reproducibility.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'fs';

const db = new DatabaseSync('/home/z/my-project/benchmark/benchmark.db');
const RUN_ID = 'baseline-v1';
const PER_DOMAIN = 8; // 20 domains × 8 = 160 tasks ≈ 16% full rubric coverage

// deterministic PRNG (mulberry32) so the sample is reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261016);

const tasks = db.prepare(`
  SELECT t.task_id, t.domain, t.difficulty, t.split, s.score as auto_score
  FROM tasks t
  JOIN results r ON r.task_id = t.task_id AND r.run_id = ? AND r.status='ok'
  LEFT JOIN scores s ON s.task_id = t.task_id AND s.run_id = ?
  ORDER BY t.task_id`).all(RUN_ID, RUN_ID);

const byDomain = {};
for (const t of tasks) (byDomain[t.domain] ??= []).push(t);

const picked = [];
for (const [domain, list] of Object.entries(byDomain)) {
  // shuffle deterministically, then balance across difficulty
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  // quota: Easy 1, Medium 3, Hard 3, Expert 1 (clamped by availability)
  const quota = { Easy: 1, Medium: 3, Hard: 3, Expert: 1 };
  const buckets = { Easy: [], Medium: [], Hard: [], Expert: [] };
  for (const t of list) (buckets[t.difficulty] ??= []).push(t);
  const chosen = new Set();
  for (const [d, n] of Object.entries(quota)) for (const t of buckets[d] ?? []) { if (chosen.size >= PER_DOMAIN) break; if (chosen.size < PER_DOMAIN && [...chosen].filter(x => x === t.task_id).length < n && (buckets[d].indexOf(t) < n || chosen.size < PER_DOMAIN)) { chosen.add(t.task_id); buckets[d].shift(); } }
  // fill remaining from any bucket ensuring split variety
  for (const t of list) { if (chosen.size >= PER_DOMAIN) break; chosen.add(t.task_id); }
  for (const id of chosen) picked.push({ task_id: id, domain });
}

writeFileSync('/home/z/my-project/benchmark/rubric_sample.json', JSON.stringify(picked, null, 1));
writeFileSync('/home/z/my-project/benchmark/rubric_sample.txt', picked.map(p => p.task_id).join('\n') + '\n');
console.log(`sample selected: ${picked.length} tasks across ${Object.keys(byDomain).length} domains`);
db.close();
