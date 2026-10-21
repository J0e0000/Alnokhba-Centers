/**
 * عسرنة اختبارات معزولة — سيرفر standalone على قاعدة SQLite مؤقتة منفصلة تمامًا
 * عن ديف والإنتاج (spec: لا يُستخدم بيانات حقيقية أبدًا).
 *
 * الاستخدام:
 *   npm run build                 (مرة واحدة — بيتبنى standalone)
 *   npx tsx scripts/tests/harness.mts <script.mts>
 * أو جوه سكريبت:
 *   const h = await startTestServer(); ... await h.stop();
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

export type TestServer = {
  baseUrl: string;
  dbFile: string;
  stop: () => Promise<void>;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      resolve(addr.port);
      srv.close();
    });
    srv.on("error", reject);
  });
}

async function waitReady(baseUrl: string, tries = 90): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      const res2 = res ?? (await fetch(baseUrl, { signal: AbortSignal.timeout(3000) }).catch(() => null));
      if (res2 && res2.status < 500) return;
    } catch { /* لسه بيقوم */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("السيرفر الاختباري ماقامش خلال المهلة");
}

export async function startTestServer(): Promise<TestServer> {
  const work = mkdtempSync(path.join(tmpdir(), "nokhba-test-"));
  const dbFile = path.join(work, "test.db");
  const url = `file:${dbFile}`;
  const env = { ...process.env, DATABASE_URL: url, NK_RATELIMIT_OFF: "1" };

  // 1) سكيما على القاعدة المؤقتة (إضافة فقط — مفيش reset لأي قاعدة تانية)
  const push = spawn("npx", ["prisma", "db", "push", "--skip-generate"], { env, cwd: process.cwd(), stdio: "pipe" });
  const pushCode = await new Promise<number>((resolve) => push.on("exit", resolve));
  if (pushCode !== 0) {
    process.stderr.write(push.stdout.toString().slice(-2000));
    process.stderr.write(push.stderr.toString().slice(-2000));
    throw new Error("prisma db push فشل على القاعدة المؤقتة");
  }

  // 2) سيرفر standalone (المطلوب build قبلها)
  const port = await freePort();
  const serverJs = path.join(process.cwd(), ".next", "standalone", "server.js");
  const child: ChildProcess = spawn("node", [serverJs], {
    env: { ...env, PORT: String(port), HOSTNAME: "127.0.0.1" },
    cwd: process.cwd(),
    stdio: "pipe",
  });
  child.stderr?.on("data", (d: Buffer) => { if (process.env.TEST_VERBOSE) process.stderr.write(d); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitReady(baseUrl);

  return {
    baseUrl,
    dbFile,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(); }, 4000);
        child.on("exit", () => { clearTimeout(t); resolve(); });
      });
      try { rmSync(work, { recursive: true, force: true }); } catch { /* ونادرًا مقفول */ }
    },
  };
}
