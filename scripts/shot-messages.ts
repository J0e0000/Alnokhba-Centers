/* لقطات نهائية: تاب الرسائل عند الموظفين (شيبس + نموذج الإعلان + الواتساب) */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#username").fill("reception");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(3000);

  // تاب الرسائل (في البار السفلي للاستقبال؟ لا — من المزيد)
  await page.getByRole("button", { name: "المزيد" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "الرسائل", exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shot-messages-portal-announcements.png`, fullPage: false });

  // شيبس الواتساب
  await page.getByRole("button", { name: /رسائل واتساب/ }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/shot-messages-whatsapp.png`, fullPage: false });

  console.log("errors:", errors);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
