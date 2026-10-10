/* تشخيص: ليه الويزارد مش بيفتح على الموبايل لما نمسح 99002؟ */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();

  // جهّز بيانات تجريبية (manager من كونتكست منفصل)
  const mgrCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mgr = await mgrCtx.newPage();
  await mgr.goto(`${BASE}/`);
  await mgr.locator("#username").fill("manager");
  await mgr.locator("#password").fill("nokhba123");
  await mgr.getByRole("button", { name: "دخول" }).click();
  await mgr.waitForTimeout(2500);
  await mgr.evaluate(async () => { await fetch("/api/demo", { method: "POST" }); });
  console.log("demo prepared");

  // موبايل استقبال
  const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mob = await mobCtx.newPage();
  const errors: string[] = [];
  mob.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  mob.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  mob.on("response", (r) => { if (r.url().includes("/api/attendance/scan")) console.log("SCAN API:", r.status()); });

  await mob.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await mob.locator("#username").fill("reception");
  await mob.locator("#password").fill("nokhba123");
  await mob.getByRole("button", { name: "دخول" }).click();
  await mob.waitForTimeout(2800);

  await mob.locator('nav[aria-label="التنقل الرئيسي"]').getByText("الحضور").click();
  await mob.waitForTimeout(2000);

  const input = mob.locator('input[data-testid="scan-input"]');
  console.log("input enabled:", await input.isEnabled());
  await mob.screenshot({ path: `${OUT}/debug-mobile-scan.png` });

  await input.click();
  await input.fill("99002");
  await mob.waitForTimeout(2000);
  await mob.screenshot({ path: `${OUT}/debug-mobile-wizard.png` });

  const bodyText = await mob.evaluate(() => document.body.innerText.slice(0, 800));
  console.log("===== BODY =====");
  console.log(bodyText);

  console.log("ERRORS:", errors.length === 0 ? "صفر" : errors.slice(0, 3));

  // cleanup
  await mgr.evaluate(async () => { await fetch("/api/demo?confirm=demo", { method: "DELETE" }); });
  console.log("demo cleaned");
  await browser.close();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
