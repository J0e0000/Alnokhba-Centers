/* تحقق بصري نهائي: كارت الرصيد في بورتال الطالب بالجنيه الصح */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await page.locator("#pcode").fill("١٠٠٠٢");
  await page.locator("#pphone").fill("01055552222");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2500);

  // القيمة من الـ API (قروش) للمقارنة
  const apiBal = await page.evaluate(async () => {
    const r = await fetch("/api/portal");
    return (await r.json()).balance as number;
  });
  console.log("API balance (piastres):", apiBal, "→ expected EGP:", apiBal / 100);

  const balText = (await page.locator('section:has(h3:has-text("رصيدك في السنتر")) p.nk-num').first().innerText()).trim();
  console.log("Displayed on card:", balText);

  await page.screenshot({ path: "/home/z/my-project/download/portal-balance-fixed.png", fullPage: false });
  await browser.close();
  console.log("screenshot saved");
}

main().catch((e) => { console.error(e); process.exit(1); });
