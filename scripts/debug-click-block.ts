/* تشخيص: أي عنصر بيعترض النقر على زر «المزيد»؟ */
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
  await page.waitForTimeout(3000);

  // مكان زر «المزيد» وعنصر pointerevents عند نقطته
  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label], nav button, button'));
    const more = btns.find((b) => (b.textContent ?? "").includes("المزيد"));
    if (!more) return { found: false };
    const r = more.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    const chain: string[] = [];
    let cur: Element | null = el;
    while (cur && chain.length < 6) {
      chain.push(`${cur.tagName}.${(cur.className && typeof cur.className === "string" ? cur.className : "").split(" ").slice(0, 4).join(".")} | ${(cur.textContent ?? "").trim().slice(0, 40)}`);
      cur = cur.parentElement;
    }
    // الستاك الثابت (fixed elements) اللي ممكن يغطي
    const fixed = Array.from(document.querySelectorAll<HTMLElement>("*")).filter((e) => {
      const s = getComputedStyle(e);
      return (s.position === "fixed" || s.position === "sticky") && s.display !== "none" && e.offsetParent !== null;
    }).map((e) => ({
      tag: e.tagName,
      cls: (typeof e.className === "string" ? e.className : "").slice(0, 80),
      rect: e.getBoundingClientRect().toJSON(),
      text: (e.textContent ?? "").trim().slice(0, 60),
    })).filter((e) => e.rect.height > 0 && e.rect.top > 700);
    return {
      found: true,
      moreRect: r.toJSON(),
      elementAtPoint: chain,
      fixedBottom: fixed.slice(0, 12),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
