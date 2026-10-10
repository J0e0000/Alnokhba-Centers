// Reproduce the "خطأ غير متوقع" error in tables (schedule) views
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results: string[] = [];
const log = (k: string, v: unknown) => { results.push(`${k}: ${JSON.stringify(v)}`); console.log(`${k}:`, v); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const apiFailures: string[] = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/") && r.status() >= 400) {
    let body = "";
    try { body = await r.text(); } catch {}
    apiFailures.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")} → ${body.slice(0, 200)}`);
  }
});

// login as manager via quick demo button
await page.goto(BASE);
await page.waitForTimeout(1500);
const quickBtn = page.locator('button:has-text("مدير — مركز النخبة")').first();
if (await quickBtn.count()) {
  await quickBtn.click();
  await page.waitForTimeout(3000);
}
log("logged_in", (await page.locator('button:has-text("الجداول")').count()) > 0);

// Go to schedule (الجداول)
const navBtn = page.locator('button:has-text("الجداول")').first();
if (await navBtn.count()) {
  await navBtn.click();
  await page.waitForTimeout(2500);
  const errVisible = await page.locator('text=حصل خطأ غير متوقع').count();
  log("schedule_error_visible", errVisible);
  log("schedule_hall_rows", await page.locator("tr").count());
} else {
  log("schedule_nav_not_found", true);
  // try links too
  const link = page.locator('a:has-text("الجداول")').first();
  log("schedule_link_found", await link.count());
  if (await link.count()) { await link.click(); await page.waitForTimeout(2500); }
  log("schedule_error_visible", await page.locator('text=حصل خطأ غير متوقع').count());
}

// check dashboard too
const dashBtn = page.locator('button:has-text("الرئيسية"), a:has-text("الرئيسية")').first();
if (await dashBtn.count()) {
  await dashBtn.click();
  await page.waitForTimeout(2000);
  log("dashboard_error_visible", await page.locator('text=حصل خطأ غير متوقع').count());
}

log("API_FAILURES", apiFailures);
await browser.close();
console.log("\n=== RESULTS ===\n" + results.join("\n"));
