/* اختبار: تبسيط الـ wizard + جدول الحصص المقسم بالقاعات + البحث بالاسم في الحضور */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0,150)}`); });

  // ---- login ----
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /مدير — مركز النخبة/ }).click();
  await page.waitForTimeout(2000);

  // ============================================================
  // 1) الجدول الأسبوعي = جدول واحد مقسم بالقاعات (hall-section rows)
  // ============================================================
  await page.locator("aside").getByRole("button", { name: "الجداول" }).click();
  await page.waitForTimeout(1500);

  // النهاردة الافتراضي — لازم نلاقي table واحد (مش per-hall cards)
  const scheduleTables = await page.locator("main table").count();
  console.log("SCHEDULE_TABLE_COUNT:", scheduleTables);

  // عدّ th من الـ thead (صف الإيداع العلوي) — لازم 5 أو 6
  const scheduleCols = await page.locator("main table thead th").count();
  console.log("SCHEDULE_COL_COUNT:", scheduleCols);

  // عدّ rows الـ tbody (slot rows + hall-section divider rows + empty hint rows)
  const scheduleRows = await page.locator("main table tbody tr").count();
  console.log("SCHEDULE_TBODY_ROWS:", scheduleRows);

  // hall-section divider rows = tr Inside tbody that has th[colspan]
  const hallDividerCount = await page.locator("main table tbody tr th[colSpan]").count();
  console.log("HALL_DIVIDER_ROWS:", hallDividerCount);

  await page.screenshot({ path: `${OUT}/test-schedule-single-table.png`, fullPage: true });

  // ============================================================
  // 2) الحضور: البحث بالاسم في صندوق الإدخال
  // ============================================================
  await page.locator("aside").getByRole("button", { name: "الحضور" }).click();
  await page.waitForTimeout(1500);

  // كتابة جزء من اسم طالب (مثلاً "محمد")
  const searchInput = page.locator('input[placeholder*="ابحث بالاسم"]');
  await searchInput.fill("محمد");
  await page.waitForTimeout(700); // debounce 200ms + request

  // لازم القائمة تظهر وتحتوي على نتائج
  const suggestItems = await page.locator('div.absolute.z-30 button:has-text("كود"), div.absolute.z-30 button').count().catch(() => 0);
  // محاولة أبسط — أي زرار جوّه الـ dropdown
  const dropdownVisible = await page.locator('div.absolute.z-30').first().isVisible().catch(() => false);
  console.log("SEARCH_DROPDOWN_VISIBLE:", dropdownVisible);

  // خد text الـ dropdown
  const dropdownText = await page.locator('div.absolute.z-30').first().textContent().catch(() => "");
  console.log("SEARCH_DROPDOWN_TEXT_PREVIEW:", (dropdownText ?? "").slice(0, 200));

  await page.screenshot({ path: `${OUT}/test-scan-name-search.png` });

  // امسح وكتب كود 5 أرقام (الـ shortcut بيتخطّاه)
  await searchInput.fill("");
  await searchInput.fill("10001");
  await page.waitForTimeout(300);

  // لازم الـ dropdown مايظهرش لأن 5 أرقام → skip
  const dropdownAfterCode = await page.locator('div.absolute.z-30').first().isVisible().catch(() => false);
  console.log("DROPDOWN_HIDDEN_FOR_5_DIGIT_CODE:", !dropdownAfterCode);

  // امسح
  await searchInput.fill("");

  // ============================================================
  // 3) الـ wizard المبسّط: سؤال واحد بدل سؤالين
  // ============================================================
  // اعمل سكان بالكود 10001
  await searchInput.fill("10001");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1800);

  // لازم نلاقي الـ result card + الـ wizard بـ step واحد بس
  const resultCard = page.locator('div.rounded-3xl').filter({ hasText: /دفع كام|هيدفع كام/ }).first();
  const wizardVisible = await resultCard.isVisible().catch(() => false);
  console.log("WIZARD_VISIBLE:", wizardVisible);

  // عدّ الـ QuickChip في الـ wizard (المفروض يكون فيه اختصارات 100/150/200/250/سعر الحصة/المطلوب)
  const quickChipCount = await resultCard.locator('button.rounded-full').count();
  console.log("QUICK_CHIPS_COUNT:", quickChipCount);

  // لقطة
  await page.screenshot({ path: `${OUT}/test-simplified-wizard.png` });

  // لازم مايكونش فيه زرار "رجوع" (ArrowRight) في الـ wizard لأنه خطوة واحدة
  const backButton = resultCard.locator('button[aria-label="رجوع"]');
  const backCount = await backButton.count();
  console.log("BACK_BUTTON_COUNT:", backCount);

  // method chips (كاش/فودافون/انستاباي) لازم يكونوا ظاهرين في نفس الشاشة
  const methodChips = await resultCard.locator('text=كاش').count();
  const vodafoneChips = await resultChipCount(resultCard, "فودافون");
  const instapayChips = await resultChipCount(resultCard, "انستاباي");
  console.log("METHOD_CHIPS:", JSON.stringify({ cash: methodChips, vodafone: vodafoneChips, instapay: instapayChips }));

  // اختار 200 من الـ shortcut chips
  const chip200 = resultCard.locator('button.rounded-full', { hasText: /^200$/ }).first();
  if (await chip200.isVisible().catch(() => false)) {
    await chip200.click();
    await page.waitForTimeout(200);
    // المبلغ في الـ input لازم يكون 200
    const amtVal = await resultCard.locator('input').first().inputValue();
    console.log("AMOUNT_AFTER_200_CHIP:", amtVal);
  } else {
    console.log("AMOUNT_AFTER_200_CHIP: chip-200-not-found");
  }

  await page.screenshot({ path: `${OUT}/test-wizard-200-selected.png` });

  // تأكيد
  const confirmBtn = resultCard.locator('button', { hasText: /تأكيد دفع|حضور \+ دفع/ }).first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
    await page.waitForTimeout(2500);
    // لازم نرجع للـ scan (الـ success card بيتقفل تلقائياً)
    const doneVisible = await page.locator('text=جاهز للطالب الجاي').first().isVisible().catch(() => false);
    console.log("DONE_SUCCESS_CARD:", doneVisible);
  }

  console.log("PAGE_ERRORS:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
}

async function resultChipCount(root: any, text: string): Promise<number> {
  try {
    return await root.locator(`text=${text}`).count();
  } catch {
    return 0;
  }
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
