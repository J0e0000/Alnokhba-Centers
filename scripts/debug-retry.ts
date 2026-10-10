/** debug: ليه retry بعد الشبكة بترجع مش بيرجع التطبيق في Playwright */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 120)));
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0, 80), r.failure()?.errorText));

  const loginRes = await page.request.post(`${BASE}/api/portal`, { data: { action: "login", code: "10001", phone: "01055551111" } });
  console.log("login:", loginRes.status());
  const setCookie = loginRes.headers()["set-cookie"];
  console.log("cookie:", setCookie?.split(";")[0].slice(0, 30));
  if (setCookie) {
    const [name, value] = setCookie.split(";")[0].split("=");
    await ctx.addCookies([{ name, value, url: BASE }]);
  }

  await page.route(`${BASE}/api/portal`, (route) => route.abort());
  await page.goto(`${BASE}/portal`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  console.log("after-abort text:", (await page.textContent("body") ?? "").slice(0, 60));

  await page.unroute(`${BASE}/api/portal`);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("جرب تاني"));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log("retry clicked:", clicked);
  await page.waitForTimeout(5000);
  console.log("after-retry text:", (await page.textContent("body") ?? "").slice(0, 100));
  await page.screenshot({ path: "/home/z/my-project/download/debug-retry.png" });

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
