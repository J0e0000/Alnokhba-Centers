import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  page.on("pageerror", (err) => console.log("PAGEERROR:", err.stack ?? String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE-ERR:", msg.text().slice(0, 500));
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("BODY:", body);
  const hasUsername = await page.locator("#username").count();
  console.log("has #username:", hasUsername);
  await browser.close();
}

main();
