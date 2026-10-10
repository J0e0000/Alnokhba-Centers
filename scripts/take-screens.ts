/* لقطات توثيقية للشاشات الجديدة — للفحص البصري */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();

  // ===== بورتال الطالب (موبايل)
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await pctx.newPage();
  await p.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await p.locator("#pcode").fill("10002");
  await p.locator("#pphone").fill("01055552222");
  await p.getByRole("button", { name: "دخول" }).click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${OUT}/shot-portal-home.png` });
  await p.getByRole("button", { name: "جدولي" }).first().click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/shot-portal-schedule.png` });
  await pctx.close();

  // ===== شاشة الموظفين: داشبورد الكروت + الإعلانات + الطوارئ (موبايل)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/shot-dashboard-cards.png`, fullPage: false });

  // شاشة الإعلانات
  await page.getByRole("button", { name: "المزيد" }).click().catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "الإعلانات", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/shot-announcements.png` });

  // شاشة الطوارئ
  await page.getByRole("button", { name: "المزيد" }).click().catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "الطوارئ", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/shot-emergency.png` });
  await ctx.close();

  // ===== شاشة الدخول (فيها رابط بورتال الطالب)
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.screenshot({ path: `${OUT}/shot-login-portal-link.png` });
  await ctx2.close();

  await browser.close();
  console.log("OK — screenshots saved");
}

main().catch((e) => { console.error(e); process.exit(1); });
