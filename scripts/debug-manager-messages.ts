/* تصحيح: مسار المدير → المزيد → الرسائل */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/dbg-1-manager-home.png" });

  // المزيد
  const more = page.getByRole("button", { name: "المزيد" });
  console.log("المزيد count:", await more.count());
  await more.click().catch((e) => console.log("more click err:", e.message.slice(0, 100)));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/dbg-2-sheet.png" });

  // الرسائل جوّه الشيت
  const msgBtn = page.getByRole("button", { name: "الرسائل", exact: true });
  console.log("الرسائل exact count:", await msgBtn.count());
  await msgBtn.first().click().catch((e) => console.log("msg click err:", e.message.slice(0, 150)));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/dbg-3-messages.png" });
  console.log("chips إعلانات البورتال:", await page.getByText("إعلانات البورتال").count());
  console.log("إعلان جديد:", await page.getByText("إعلان جديد").count());

  console.log("errors:", errors.slice(0, 5));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
