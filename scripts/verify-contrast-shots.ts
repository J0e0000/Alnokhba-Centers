import { chromium } from "playwright";
import fs from "fs";
const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download/contrast-shots";
fs.mkdirSync(OUT, { recursive: true });
async function main() {
  const b = await chromium.launch();
  // ===== staff app: manager light + dark =====
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.fill("#username", "manager");
  await p.fill("#password", "nokhba123");
  await p.click('button[type="submit"]');
  await p.waitForURL("**/app**", { timeout: 30000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => localStorage.setItem("nk-theme", "light"));
  await p.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${OUT}/verify-manager-light.png` });
  await p.evaluate(() => localStorage.setItem("nk-theme", "dark"));
  await p.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${OUT}/verify-manager-dark.png` });
  await ctx.close();
  // ===== academia teacher light + dark (mobile) =====
  const ac = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ap = await ac.newPage();
  await ap.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await ap.waitForTimeout(1200);
  await ap.fill("#username", "aca-teacher1");
  await ap.fill("#password", "academia123");
  await ap.click('button[type="submit"]');
  await ap.waitForURL("**/academia**", { timeout: 30000 });
  await ap.waitForTimeout(2000);
  await ap.evaluate(() => localStorage.setItem("nk-theme", "light"));
  await ap.goto(`${BASE}/academia`, { waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(2200);
  await ap.screenshot({ path: `${OUT}/verify-academia-light.png` });
  await ap.evaluate(() => localStorage.setItem("nk-theme", "dark"));
  await ap.goto(`${BASE}/academia`, { waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(2200);
  await ap.screenshot({ path: `${OUT}/verify-academia-dark.png` });
  await ac.close();
  // ===== landing =====
  const lc = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const lp = await lc.newPage();
  await lp.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await lp.waitForTimeout(1800);
  await lp.screenshot({ path: `${OUT}/verify-landing-light.png` });
  await lc.close();
  await b.close();
  console.log("shots done");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
