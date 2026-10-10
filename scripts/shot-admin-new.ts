/** لقطات تحقق بصري: النسخ الاحتياطية + الفرق + بانر الدعم الفني */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// login as admin
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill('input[autocomplete="username"], input[name="username"], #username', "admin").catch(() => {});
const inputs = await page.locator("input").all();
if (inputs.length >= 2) {
  await inputs[0].fill("admin");
  await inputs[1].fill("nokhba123");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
}
console.log("logged in:", await page.locator("text=السناتر").count() > 0);

// 1) backups view
await page.click('button:has-text("النسخ الاحتياطية")').catch(async () => {
  // mobile tabs or desktop nav
  await page.locator('button, a').filter({ hasText: "النسخ الاحتياطية" }).first().click();
});
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/admin-backups-new.png`, fullPage: true });
console.log("backups screenshot:", await page.locator("text=مصنفات Excel").count() > 0, "| schedule:", await page.locator("text=كل يوم جمعة").count() > 0);

// preview dialog
const previewBtn = page.locator('button:has-text("معاينة واستعادة")').first();
if (await previewBtn.count() > 0) {
  await previewBtn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/admin-backups-restore-dialog.png` });
  console.log("restore dialog screenshot taken");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// 2) teams view
await page.locator('button, a').filter({ hasText: "الفرق" }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/admin-teams-new.png` });
console.log("teams screenshot:", await page.locator("text=فريق جديد").count() > 0);

// 3) support access: centers → التفاصيل → دعم
await page.locator('button, a').filter({ hasText: "السناتر" }).first().click();
await page.waitForTimeout(1200);
const detailBtn = page.locator('button:has-text("التفاصيل")').first();
if (await detailBtn.count() > 0) {
  await detailBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/admin-center-users.png` });
  console.log("center users screenshot:", await page.locator("text=موظفو السنتر").count() > 0);
  const supportBtn = page.locator('button:has-text("دعم")').first();
  if (await supportBtn.count() > 0) {
    await supportBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/admin-support-dialog.png` });
    console.log("support dialog screenshot:", await page.locator("text=سبب الدعم").count() > 0);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("Escape");
}

await browser.close();
console.log("DONE");
