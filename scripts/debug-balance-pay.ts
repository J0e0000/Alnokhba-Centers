/* تشخيص: زرار "دفع من الرصيد" — ماذا يحدث بعد الضغط؟ */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();

  // جهّز التجربة
  const mgrCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mgr = await mgrCtx.newPage();
  await mgr.goto(`${BASE}/`);
  await mgr.locator("#username").fill("manager");
  await mgr.locator("#password").fill("nokhba123");
  await mgr.getByRole("button", { name: "دخول" }).click();
  await mgr.waitForTimeout(2500);
  await mgr.evaluate(async () => { await fetch("/api/demo", { method: "POST" }); });

  // موبايل استقبال
  const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mob = await mobCtx.newPage();
  mob.on("response", async (r) => {
    if (r.url().includes("/api/attendance/mark") || r.url().includes("/api/payments")) {
      const body = await r.text().catch(() => "");
      console.log("API:", r.request().method(), r.url().replace(BASE, ""), r.status(), body.slice(0, 150));
    }
  });
  await mob.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await mob.locator("#username").fill("reception");
  await mob.locator("#password").fill("nokhba123");
  await mob.getByRole("button", { name: "دخول" }).click();
  await mob.waitForTimeout(2800);

  await mob.locator('nav[aria-label="التنقل الرئيسي"]').getByText("الحضور").click();
  await mob.waitForTimeout(2000);

  // اختار التجريبية A
  const chip = mob.locator("button", { hasText: "تجريبي A" }).first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    await mob.waitForTimeout(600);
    console.log("clicked demo chip");
  }

  const input = mob.locator('input[data-testid="scan-input"]');
  await input.click();
  await input.fill("99002");
  await mob.waitForTimeout(2000);
  await mob.screenshot({ path: `${OUT}/debug-wizard-open.png` });

  // دوس دفع من الرصيد
  const btn = mob.getByRole("button", { name: /دفع من رصيده/ });
  console.log("button visible:", await btn.isVisible().catch(() => false));
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await mob.waitForTimeout(2500);
    await mob.screenshot({ path: `${OUT}/debug-after-balance-pay.png` });
    const bodyTxt = await mob.evaluate(() => document.body.innerText.slice(0, 700));
    console.log("===== BODY AFTER =====");
    console.log(bodyTxt);
  }

  // cleanup
  await mgr.evaluate(async () => { await fetch("/api/demo?confirm=demo", { method: "DELETE" }); });
  console.log("demo cleaned");
  await browser.close();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
