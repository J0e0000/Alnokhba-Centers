// Verification screenshots for the AlNokhba Management redesign (Task ID: ui-restructure)
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/scripts";

(async () => {
  const browser = await chromium.launch();
  const shots = [];

  // 1) Landing (light-locked) — desktop + mobile
  let page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/v2-landing-top.png` });
  await page.evaluate(() => document.getElementById("how")?.scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/v2-landing-how.png` });
  await page.evaluate(() => document.getElementById("ecosystem")?.scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/v2-landing-eco.png` });
  await page.evaluate(() => document.getElementById("problem")?.scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/v2-landing-problem.png` });
  shots.push("landing");

  // 2) Login
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/v2-login.png` });
  shots.push("login");

  // 3) Mobile landing
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(BASE + "/", { waitUntil: "networkidle" });
  await mob.waitForTimeout(600);
  await mob.screenshot({ path: `${OUT}/v2-landing-mobile.png` });
  shots.push("landing-mobile");

  // 4) App dashboard — seeded dev login (light + dark)
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator("input[autocomplete='username']").first().fill("manager");
  await page.locator("input[type='password']").first().fill("nokhba123");
  await page.locator("form").first().locator("button[type='submit'], button:not([type])").first().click();
  await page.waitForURL("**/app**", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/v2-app-light.png` });
  // dark mode toggle
  const themeBtn = page.locator("button[aria-label*='الوضع']").first();
  if (await themeBtn.count()) {
    await themeBtn.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/v2-app-dark.png` });
  }
  // today tab on mobile
  const mobApp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobApp.goto(BASE + "/login", { waitUntil: "networkidle" });
  await mobApp.locator("input[autocomplete='username']").first().fill("manager");
  await mobApp.locator("input[type='password']").first().fill("nokhba123");
  await mobApp.locator("form").first().locator("button[type='submit'], button:not([type])").first().click();
  await mobApp.waitForURL("**/app**", { timeout: 20000 }).catch(() => {});
  await mobApp.waitForTimeout(3000);
  await mobApp.screenshot({ path: `${OUT}/v2-app-mobile.png` });
  shots.push("app-light", "app-dark", "app-mobile");

  await browser.close();
  console.log("done:", shots.join(", "));
})().catch((e) => { console.error(e); process.exit(1); });
