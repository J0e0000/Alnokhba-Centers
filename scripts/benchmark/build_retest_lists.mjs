// build_retest_lists.mjs — Phase 5 prep: who gets retested under sysprompt-v2
// - affected: Development-split tasks with baseline score < 85 (or real error classes)
// - regression-guard: a sample of Development tasks that PASSED (must stay passing)
// - validation: ALL Validation-split tasks (A/B baseline vs v2)
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'fs';

const db = new DatabaseSync('/home/z/my-project/benchmark/benchmark.db');
const RUN = 'baseline-v1';

const rows = db.prepare(`
  SELECT t.task_id, t.split, t.domain, s.score, s.error_class
  FROM tasks t
  JOIN results r ON r.task_id = t.task_id AND r.run_id = ? AND r.status = 'ok'
  LEFT JOIN scores s ON s.task_id = t.task_id AND s.run_id = ?
  ORDER BY t.task_id`).all(RUN, RUN);

const affected = [], guard = [];
for (const r of rows) {
  if (r.split !== 'Improve/Development') continue;
  const failed = r.score !== null && r.score !== undefined && r.score < 85;
  if (failed) affected.push(r.task_id);
}
// guard: passing dev tasks, prefer ones from the same domains as failures
const passers = rows.filter(r => r.split === 'Improve/Development' && r.score !== null && r.score >= 85);
const failDomains = new Set(rows.filter(r => r.score !== null && r.score < 85).map(r => r.domain));
const guards = passers.filter(p => failDomains.has(p.domain)).slice(0, 8);
for (const g of guards) guard.push(g.task_id);

const validation = rows.filter(r => r.split === 'Validation').map(r => r.task_id);

writeFileSync('/home/z/my-project/benchmark/retest_affected.txt', affected.join('\n') + '\n');
writeFileSync('/home/z/my-project/benchmark/retest_guard.txt', guard.join('\n') + '\n');
writeFileSync('/home/z/my-project/benchmark/retest_validation.txt', validation.join('\n') + '\n');
console.log(`affected(dev,<85): ${affected.length} | guard(passing sample): ${guard.length} | validation(done under baseline): ${validation.length}`);
console.log('affected:', affected.join(','));
db.close();
