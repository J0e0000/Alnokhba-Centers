const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.locator("input[autocomplete='username']").first().fill("manager");
  await page.locator("input[type='password']").first().fill("nokhba123");
  await page.locator("form").first().locator("button[type='submit'], button:not([type])").first().click();
  await page.waitForURL("**/app**", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);
  // scroll to insight / collapsed numbers area
  await page.evaluate(() => window.scrollBy(0, 900));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/home/z/my-project/scripts/v2-app-lower.png" });
  // open the collapsed details
  const det = page.locator("details summary");
  if (await det.count()) { await det.first().click(); await page.waitForTimeout(400); }
  await page.screenshot({ path: "/home/z/my-project/scripts/v2-app-lower-open.png" });
  await browser.close();
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
