/* تشخيص: ليه تاب الرسائل مش بيفتح للمدير؟ */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("#username").fill("manager");
await page.locator("#password").fill("nokhba123");
await page.getByRole("button", { name: "دخول" }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/dbug-1-dashboard.png" });

// المزيد
const moreBtn = page.getByRole("button", { name: "المزيد" });
console.log("more button count:", await moreBtn.count());
await moreBtn.click().catch((e) => console.log("more click failed:", String(e).slice(0, 100)));
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/dbug-2-more-menu.png" });

// الرسائل
const msgBtn = page.getByRole("button", { name: "الرسائل", exact: true });
console.log("messages button count:", await msgBtn.count());
await msgBtn.first().click().catch((e) => console.log("msg click failed:", String(e).slice(0, 100)));
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/dbug-3-messages.png" });

// شيبس إعلانات البورتال
const chips = await page.getByText("إعلانات البورتال").count();
console.log("portal-announcements chip count:", chips);
const annForm = await page.getByText("إعلان جديد").count();
console.log("announcement form count:", annForm);

console.log("ERRORS:", errors.slice(0, 5));
await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
