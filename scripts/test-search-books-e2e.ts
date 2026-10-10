/* E2E v2: live search dropdowns + books section + schedule fix
   Manager: schedule → students search → books (add/sell/restock) → journal
   Reception: payments search → books (sell only) */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const OUT = "/home/z/my-project/download";
const results = [];
const log = (k, v) => { results.push(`${k}: ${JSON.stringify(v)}`); console.log(k + ":", v); };

async function login(page, label) {
  await page.goto(BASE);
  await page.waitForTimeout(1800);
  await page.locator(`button:has-text("${label}")`).first().click();
  await page.waitForTimeout(2800);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  // ================= MANAGER =================
  await login(page, "مدير — مركز النخبة");
  log("manager_logged_in", await page.locator('aside button:has-text("الكتب")').count() > 0);

  // --- 1) schedule no more 500 ---
  await page.locator('aside button:has-text("الجداول")').first().click();
  await page.waitForTimeout(2500);
  log("schedule_error_gone", (await page.locator("text=حصل خطأ غير متوقع").count()) === 0);
  log("schedule_rows", await page.locator("table tbody tr").count());
  await page.screenshot({ path: `${OUT}/test-schedule-fixed.png` });

  // --- 2) students live dropdown: name ---
  await page.locator('aside button:has-text("الطلاب")').first().click();
  await page.waitForTimeout(1800);
  const inp = page.locator('input[placeholder*="ابحث بالاسم"]').first();
  await inp.click();
  await inp.fill("محمد");
  await page.waitForTimeout(900);
  const dd = page.locator("div.z-40 >> xpath=.. >> button"); // dropdown buttons
  const ddBtns = page.locator("div.z-40 button");
  log("students_drop_results", await ddBtns.count());
  if (await ddBtns.count()) {
    log("students_drop_first", (await ddBtns.first().innerText()).replace(/\n/g, " | "));
  }
  await page.screenshot({ path: `${OUT}/test-students-livedrop.png` });

  // keyboard: ArrowDown + Enter → profile
  await inp.press("ArrowDown");
  await inp.press("Enter");
  await page.waitForTimeout(1500);
  log("pick_opens_profile", await page.locator('button:has-text("رجوع للطلاب")').count() > 0);
  await page.locator('button:has-text("رجوع للطلاب")').first().click();
  await page.waitForTimeout(1000);

  // live code search: exact code ranks first
  await page.locator('input[placeholder*="ابحث بالاسم"]').first().click();
  await page.locator('input[placeholder*="ابحث بالاسم"]').first().fill("10001");
  await page.waitForTimeout(900);
  const codeFirst = await page.locator("div.z-40 button").first().innerText().catch(() => "");
  log("code_rank_first", codeFirst.includes("10001") ? "YES" : `NO → ${codeFirst.replace(/\n/g, " ")}`);

  // --- 3) books: add ---
  await page.locator('aside button:has-text("الكتب")').first().click();
  await page.waitForTimeout(1800);
  log("books_title", await page.locator("h1:has-text('الكتب')").count() > 0);

  await page.locator('button:has-text("إضافة كتاب")').first().click();
  await page.waitForTimeout(900);
  const dlg = page.locator('[role="dialog"]').last();
  await dlg.locator('input[placeholder*="كتاب الفيزياء"]').fill("كتاب الأحياء — الثاني الثانوي");
  await dlg.locator("select").nth(0).selectOption({ index: 1 });
  await dlg.locator('input[placeholder="150"]').fill("120");
  await dlg.locator('input[placeholder="20"]').fill("15");
  await dlg.locator('button:has-text("إضافة الكتاب")').click();
  await page.waitForTimeout(1800);
  log("book_in_table", await page.locator("td:has-text('كتاب الأحياء')").count() > 0);
  log("stock_15", await page.locator("td span:has-text('15')").count() > 0);
  await page.screenshot({ path: `${OUT}/test-books-inventory.png` });

  // --- sell: qty 2 + student picker ---
  await page.locator('tbody button:has-text("بيع")').first().click();
  await page.waitForTimeout(900);
  const sd = page.locator('[role="dialog"]').last();
  await sd.locator('button:has(svg[class*="lucide-plus"])').first().click(); // qty → 2
  const buyer = sd.locator('input[placeholder*="ابحث عن الطالب"]').first();
  await buyer.click();
  await buyer.fill("محمد");
  await page.waitForTimeout(900);
  const buyerDd = sd.locator("div.z-40 button");
  log("buyer_drop_count", await buyerDd.count());
  if (await buyerDd.count()) await buyerDd.first().click();
  await page.waitForTimeout(500);
  log("buyer_picked", await sd.locator("text=محمد").count() > 0);
  log("total_240", await sd.locator("text=240").count() > 0);
  await page.screenshot({ path: `${OUT}/test-books-sell-dialog.png` });
  await sd.locator('button:has-text("تأكيد البيع")').click();
  await page.waitForTimeout(1800);
  log("sale_recorded", await page.locator("td:has-text('محمد')").count() > 0);
  log("stock_13", await page.locator("td span:has-text('13')").count() > 0);
  await page.screenshot({ path: `${OUT}/test-books-after-sale.png` });

  // --- restock +10 ---
  await page.locator('button[title="توريد نسخ"]').first().click();
  await page.waitForTimeout(700);
  const rd = page.locator('[role="dialog"]').last();
  await rd.locator('button:has-text("+10")').click();
  await rd.locator('button:has-text("تأكيد التوريد")').click();
  await page.waitForTimeout(1500);
  log("restock_to_23", await page.locator("td span:has-text('23')").count() > 0);

  // --- journal shows بيع كتاب ---
  await page.locator('aside button:has-text("الحسابات")').first().click();
  await page.waitForTimeout(1800);
  await page.locator('button:has-text("اليومية")').first().click();
  await page.waitForTimeout(1200);
  log("journal_book_sale", await page.locator("text=بيع كتاب").count() > 0);
  await page.screenshot({ path: `${OUT}/test-journal-book-sale.png` });

  // ================= RECEPTIONIST =================
  await page.locator('button[aria-label="تسجيل الخروج"]').click();
  await page.waitForTimeout(1500);
  await login(page, "موظف استقبال — النخبة");
  log("reception_logged_in", await page.locator('aside button:has-text("الكتب")').count() > 0);

  // payments live search
  await page.locator('aside button:has-text("الدفع")').first().click();
  await page.waitForTimeout(1500);
  const pay = page.locator('input[placeholder*="ابحث"]').first();
  await pay.click();
  await pay.fill("يوسف");
  await page.waitForTimeout(900);
  const payDd = page.locator("div.z-40 button");
  log("payments_drop_count", await payDd.count());
  if (await payDd.count()) {
    await payDd.first().click();
    await page.waitForTimeout(1500);
    log("payments_panel_open", await page.locator("button:has-text('رجوع للبحث')").count() > 0);
  }
  await page.screenshot({ path: `${OUT}/test-payments-livedrop.png` });

  // books: sell yes, add no
  await page.locator('aside button:has-text("الكتب")').first().click();
  await page.waitForTimeout(1500);
  log("reception_no_add", (await page.locator('button:has-text("إضافة كتاب")').count()) === 0);
  log("reception_sell_visible", (await page.locator('button:has-text("بيع")').count()) > 0);
  log("reception_stock_23", await page.locator("td span:has-text('23')").count() > 0);

  log("PAGE_ERRORS", pageErrors);
  log("CONSOLE_ERRORS", consoleErrors.slice(0, 5));

  await browser.close();
  console.log("\n=== RESULTS ===\n" + results.join("\n"));
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
