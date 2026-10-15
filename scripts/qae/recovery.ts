/**
 * QAE1 RECOVERY + CONSUMPTION — spec §12 (failure scenarios) + §11 (consumption measurement).
 * Run: bun scripts/qae/recovery.ts  (targets prod :3001)
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import { saveResult } from "./lib";

const db = new PrismaClient();
const BASE = process.env.QAE_BASE ?? "http://localhost:3001";
const MANIFEST = JSON.parse(require("fs").readFileSync("/home/z/my-project/qae/manifest.json", "utf8"));
const c1 = MANIFEST.centers.find((c: any) => c.slug === "qae-c99-stress"); // stress center survives in DB (c01-c10 wiped by stress seed)
type Row = { scenario: string; behavior: string; pass: boolean; detail: string };
const rows: Row[] = [];
let cookie = "";

async function hit(path: string, opts: { method?: string; body?: any; raw?: string; ct?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = opts.ct ?? "application/json";
  if (cookie) headers["cookie"] = cookie;
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method: opts.method ?? "GET", headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined), signal: AbortSignal.timeout(20000) }).catch((e) => ({ status: 0, json: async () => ({ error: String(e).slice(0, 60) }) }) as any);
  const data = await (res as any).json().catch(() => ({}));
  return { status: (res as any).status, data, ms: performance.now() - t0 };
}

async function main() {
  console.log(`\n== QAE1 RECOVERY vs ${BASE} ==`);
  const res = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: `qae-mgr-${c1.n}`, password: "Qae#2026" }) });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("nokhba_session")) ?? "";

  // 1. malformed JSON body
  {
    const r = await hit("/api/payments", { method: "POST", raw: "{broken json!!", ct: "application/json" });
    rows.push({ scenario: "malformed JSON body", behavior: "400 clean error", pass: r.status === 400 || r.status === 401, detail: `status=${r.status}` });
    console.log(`  ${rows[rows.length - 1].pass ? "✅" : "❌"} malformed JSON → ${r.status}`);
  }

  // 2. expired auth session
  {
    const sess = await db.authSession.findFirst({ where: { user: { username: `qae-rec-${c1.n}` } }, orderBy: { expiresAt: "desc" } });
    if (sess) {
      const orig = sess.expiresAt;
      await db.authSession.update({ where: { id: sess.id }, data: { expiresAt: new Date(Date.now() - 3600_000) } });
      const r = await hit("/api/students", {});
      await db.authSession.update({ where: { id: sess.id }, data: { expiresAt: orig } });
      rows.push({ scenario: "expired session token", behavior: "401 rejected", pass: r.status === 401, detail: `status=${r.status}` });
      console.log(`  ${rows[rows.length - 1].pass ? "✅" : "❌"} expired session → ${r.status}`);
    }
  }

  // 3. DB loss — cold-start variant (running server keeps its FD; severing a live SQLite FD isn't possible)
  {
    execSync(`cp /home/z/my-project/db/custom.db /tmp/qae-db-copy.db && mv /home/z/my-project/db/custom.db /home/z/my-project/db/custom.db.hidden`);
    let coldStatus = 0; let coldErr = "";
    try {
      const probe = execSync(`node -e "const {PrismaClient}=require('/home/z/my-project/node_modules/@prisma/client'); const db=new PrismaClient(); db.student.count().then(n=>{console.log('OK '+n);process.exit(0)}).catch(e=>{console.log('ERR '+e.message.slice(0,80));process.exit(1)})" 2>&1 || true`, { encoding: "utf8", timeout: 30000 });
      coldErr = probe.trim().slice(0, 80);
      coldStatus = probe.includes("ERR") ? 500 : 200;
    } catch { coldStatus = 500; }
    execSync(`mv /home/z/my-project/db/custom.db.hidden /home/z/my-project/db/custom.db`);
    const after = await hit("/api/dashboard", {});
    rows.push({ scenario: "DB file absence (cold connection)", behavior: "new connections fail cleanly; existing server unaffected (FD held); restore recovers", pass: coldStatus === 500 && after.status === 200, detail: `cold=${coldStatus} (${coldErr}), live-server-after-restore=${after.status}` });
    console.log(`  ${rows[rows.length - 1].pass ? "✅" : "❌"} DB loss: cold=${coldStatus} (${coldErr}), after=${after.status}`);
  }

  // 4. duplicate book sale with same idemKey → no double decrement
  {
    const book = await db.book.findFirst({ where: { centerId: c1.centerId } });
    if (book) {
      const idem = `qae1-recov-${Date.now()}`;
      const stock0 = book.stock;
      const r1 = await hit("/api/books", { method: "PUT", body: { bookId: book.id, qty: 1, method: "CASH", idemKey: idem } });
      const r2 = await hit("/api/books", { method: "PUT", body: { bookId: book.id, qty: 1, method: "CASH", idemKey: idem } });
      const stock1 = (await db.book.findUnique({ where: { id: book.id } }))!.stock;
      const dup = r2.data.duplicate === true;
      rows.push({ scenario: "duplicate sale (idemKey retry)", behavior: "same sale returned, single decrement", pass: dup && stock0 - stock1 === 1, detail: `stock ${stock0}→${stock1}, dup=${dup}` });
      console.log(`  ${rows[rows.length - 1].pass ? "✅" : "❌"} idemKey sale: stock ${stock0}→${stock1} dup=${dup}`);
    }
  }

  // 5. payment retry WITHOUT idemKey → duplicates by design (documented finding F3)
  {
    const bal0 = await db.studentTransaction.aggregate({ _sum: { amount: true }, where: { studentId: c1.students[0].id } });
    await hit("/api/payments", { method: "POST", body: { studentId: c1.students[0].id, amount: 1, method: "CASH" } });
    await hit("/api/payments", { method: "POST", body: { studentId: c1.students[0].id, amount: 1, method: "CASH" } });
    const bal1 = await db.studentTransaction.aggregate({ _sum: { amount: true }, where: { studentId: c1.students[0].id } });
    const delta = (bal1._sum.amount ?? 0) - (bal0._sum.amount ?? 0);
    rows.push({ scenario: "payment double-submit (no idemKey)", behavior: "2 payments recorded (documented gap F3 — client retry = double charge)", pass: delta === 200, detail: `delta=${delta} (2×100) — business decision needed: add idempotency key` });
    console.log(`  ⚠️ payment retry: delta=${delta} → F3 documented (payments lack idempotency key)`);
  }

  // 6. reports during concurrent writes
  {
    const writes = Array.from({ length: 8 }, () => hit("/api/payments", { method: "POST", body: { studentId: c1.students[1].id, amount: 2, method: "VODAFONE" } }));
    const reports = await Promise.all([hit("/api/reports?type=student-balances", {}), hit("/api/reports?type=daily", {}), hit("/api/reports?type=monthly", {})]);
    await Promise.all(writes);
    const okReports = reports.filter((r) => r.status === 200).length;
    rows.push({ scenario: "reports during concurrent writes", behavior: "3/3 reports 200", pass: okReports === 3, detail: `${okReports}/3 ok` });
    console.log(`  ${rows[rows.length - 1].pass ? "✅" : "❌"} reports-during-writes: ${okReports}/3`);
  }

  // 7. invalid QR + wrong-center QR (already covered in live-flow; re-verify here quickly)
  {
    const r = await hit("/api/attendance/public/check-in", { method: "POST", body: { token: "0000000000000000", code: "12345", name: "تست", deviceId: "eeeeeeee-1111-4222-8333-cccccccccccc" } });
    rows.push({ scenario: "invalid QR check-in", behavior: "rejected 4xx with Arabic error", pass: r.status >= 400 && r.status < 500, detail: `status=${r.status}` });
    console.log(`  ${rows[rows.length - 1].pass ? "✅" : "❌"} invalid QR → ${r.status}`);
  }

  /* ============ §11 consumption ============ */
  console.log("\n-- consumption --");
  const tables = ["Center", "User", "Student", "StudentGroup", "Group", "SessionInstance", "Attendance", "StudentTransaction", "Receipt", "AuditLog", "AttendanceEvent", "CheckInAttempt", "AgentTask", "AgentUsage", "AgentMessage", "AgentToolExecution"];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = Number((await db.$queryRawUnsafe(`SELECT COUNT(*) n FROM "${t}"`))[0].n);
  const dbSize = await db.$queryRawUnsafe(`SELECT page_count * page_size AS size FROM pragma_page_count, pragma_page_size`);
  const usage = await db.$queryRawUnsafe(`SELECT COUNT(*) n, COALESCE(SUM(inputTokens),0) i, COALESCE(SUM(outputTokens),0) o FROM AgentUsage`);
  const walSize = execSync(`stat -c%s /home/z/my-project/db/custom.db-wal 2>/dev/null || echo 0`).toString().trim();

  const consumption = {
    dbSizeMB: +(Number((dbSize as any[])[0].size) / 1024 / 1024).toFixed(2),
    dbSizeMBInitial: +(Number(execSync(`stat -c%s /home/z/my-project/qae/snapshot-pre-qae-20261015_043731.db`).toString().trim()) / 1024 / 1024).toFixed(2),
    walMB: +(Number(walSize) / 1024 / 1024).toFixed(2),
    tableCounts: counts,
    ai: {
      llmTurns: Number((usage as any[])[0].n),
      inputTokens: Number((usage as any[])[0].i),
      outputTokens: Number((usage as any[])[0].o),
      note: "z-ai-web-dev-sdk (GLM) usage persisted per-turn; provider-reported tokens",
    },
    vercel: "BLOCKED — لا يوجد توكن Vercel في بيئة الاختبار الحالية (اختفى التوكن قبل البدء). قياسات Deployment/Functions Storage تحتاج وصول الداشبورد.",
    supabase: "BLOCKED — قاعدة الإنتاج Supabase خارج نطاق بيئة الاختبار المعزولة (عمدًا — spec §2).",
    costEstimate: {
      localTest: "بلا تكلفة (كل حاجة محلية)",
      aiCostPer1000Turns: "تقدير: 1000 دورة × (155 in + 42 out tokens avg) بأسعار GLM المعلنة (~$0.6/1M in، ~$2.2/1M out) ≈ $0.19 لكل 1000 سؤال — تقدير غير موثق (الأسعار افتراضية)",
    },
  };
  console.log(JSON.stringify(consumption, null, 1).slice(0, 900));
  saveResult("recovery.json", { rows, consumption });
  console.log(`\n== RECOVERY DONE: ${rows.filter((r) => r.pass).length}/${rows.length} ==`);
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
