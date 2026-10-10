/* Final sanity: seeded books + live search + schedule on FRESH reseeded data */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const OUT = "/home/z/my-project/download";
const results = [];
const log = (k, v) => { results.push(`${k}: ${JSON.stringify(v)}`); console.log(k + ":", v); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(BASE);
await page.waitForTimeout(1800);
await page.locator('button:has-text("مدير — مركز النخبة")').first().click();
await page.waitForTimeout(2800);

// schedule still fine
await page.locator('aside button:has-text("الجداول")').first().click();
await page.waitForTimeout(2200);
log("schedule_ok", (await page.locator("text=حصل خطأ غير متوقع").count()) === 0);

// books seeded
await page.locator('aside button:has-text("الكتب")').first().click();
await page.waitForTimeout(2000);
log("seeded_books_rows", await page.locator("tbody tr").count());
log("physics_25", await page.locator("td span:has-text('25')").count() > 0);
log("low_stock_stat", await page.locator("text=قرب يخلص").count() > 0);
log("today_sales_stat", await page.locator("text=390").count() > 0);
await page.screenshot({ path: `${OUT}/test-books-seeded.png` });

// walk-in sale on ملخص الكيمياء (stock 12)
await page.locator('tr:has-text("ملخص الكيمياء") button:has-text("بيع")').first().click();
await page.waitForTimeout(800);
const sd = page.locator('[role="dialog"]').last();
await sd.locator('button:has-text("زبون خارجي")').click();
await sd.locator('input[placeholder*="اسم الزبون"]').fill("م. سمير — أبو طالب");
await sd.locator('button:has-text("تأكيد البيع")').click();
await page.waitForTimeout(1600);
log("walkin_sale_ok", await page.locator("td:has-text('م. سمير')").count() > 0);
log("stock_11", await page.locator("td span:has-text('11')").count() > 0);

// out-of-stock book: بيع disabled
log("oos_sell_disabled", await page.locator('tr:has-text("قواعد الإنجليزي") button:disabled').count() > 0);

// students live search
await page.locator('aside button:has-text("الطلاب")').first().click();
await page.waitForTimeout(1500);
const inp = page.locator('input[placeholder*="ابحث بالاسم"]').first();
await inp.click(); await inp.fill("يوسف");
await page.waitForTimeout(800);
const ddCount = await page.locator("div.z-40 button").count();
log("search_yousef", ddCount);
if (ddCount) log("first_match", (await page.locator("div.z-40 button").first().innerText()).replace(/\n/g, " | "));
await page.screenshot({ path: `${OUT}/test-final-search.png` });

log("PAGE_ERRORS", pageErrors);
await browser.close();
console.log("\n=== RESULTS ===\n" + results.join("\n"));
