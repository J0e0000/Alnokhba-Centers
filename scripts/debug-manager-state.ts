/* تصحيح 2: اللي المدير شايفه فعليًا */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(4000);

  const bodyText = (await page.locator("body").innerText()).slice(0, 1500);
  console.log("=== BODY TEXT ===\n" + bodyText);

  const nav = page.locator('nav[aria-label="التنقل الرئيسي"]');
  console.log("\n=== NAV count:", await nav.count());
  if (await nav.count() > 0) {
    const navText = await nav.innerText();
    console.log("NAV TEXT:", navText.replace(/\n/g, " | "));
    const navBox = await nav.boundingBox();
    console.log("NAV BOX:", JSON.stringify(navBox));
  }

  const more = page.getByRole("button", { name: "المزيد" });
  const moreBox = await more.boundingBox().catch(() => null);
  console.log("MORE BOX:", JSON.stringify(moreBox));
  if (moreBox) {
    // مين اللي واقف فوقه؟
    const cx = moreBox.x + moreBox.width / 2;
    const cy = moreBox.y + moreBox.height / 2;
    const at = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const chain: string[] = [];
      let cur: Element | null = el;
      while (cur && chain.length < 5) {
        chain.push(`${cur.tagName}.${(cur.className && typeof cur.className === "string" ? cur.className : "").split(" ").slice(0, 3).join(".")}`);
        cur = cur.parentElement;
      }
      return chain.join(" → ");
    }, { x: cx, y: cy });
    console.log("AT POINT (المزيد center):", at);
  }

  await page.screenshot({ path: "/tmp/dbg-manager.png" });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
