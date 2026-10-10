/* تصحيح: تاب الرسائل في البورتال */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

  await p.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await p.locator("#pcode").fill("10002");
  await p.locator("#pphone").fill("01055552222");
  await p.getByRole("button", { name: "دخول" }).click();
  await p.waitForTimeout(3000);

  // API مباشر
  const apiData = await p.evaluate(async () => {
    const r = await fetch("/api/portal/notifications");
    return r.json();
  });
  console.log("API unread:", (apiData as { unread: number }).unread, "· notifications:", (apiData as { notifications: unknown[] }).notifications.length);

  await p.getByRole("button", { name: "الرسائل" }).first().click();
  await p.waitForTimeout(1500);
  const mainText = await p.locator("main").innerText();
  console.log("=== MAIN TEXT ===\n" + mainText.slice(0, 800));
  await p.screenshot({ path: "/tmp/dbg-portal-messages.png" });
  console.log("errors:", errors.slice(0, 3));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
