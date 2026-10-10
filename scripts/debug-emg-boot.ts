/** تشخيص إقلاع حزمة الطوارئ — رسائل الكونسول والأخطاء */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";

const html = fs.readFileSync("/tmp/pkg-test.html", "utf8");
const srv = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;

const browser = await chromium.launch();
const page = await browser.newPage();
const logs: string[] = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${e.message}\n${e.stack}`));
page.on("requestfailed", (r) => logs.push(`[REQFAIL] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

console.log("=== CONSOLE ===");
for (const l of logs.slice(0, 30)) console.log(l.slice(0, 400));
console.log("=== BOOT SCREEN TEXT ===");
const txt = await page.locator("body").textContent().catch((e) => "ERR " + e.message);
console.log((txt || "").slice(0, 400));
console.log("=== DBG hook ===", await page.evaluate(() => typeof (window as any).__NKDBG).catch((e) => "ERR " + e.message));
console.log("=== globals ===", await page.evaluate(() => ({
  hasST: typeof (window as any).ST,
  hasGo: typeof (window as any).go,
  hasBoot: typeof (window as any).boot,
  jsqr: typeof (window as any).jsQR,
  nkex: typeof (window as any).NKEX,
})).catch((e) => "ERR " + e.message));
await page.screenshot({ path: "/tmp/emg-boot-debug.png" });
await browser.close();
srv.close();
