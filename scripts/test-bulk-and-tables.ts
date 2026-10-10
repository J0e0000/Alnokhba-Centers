/* اختبار: طباعة كروت متعددة + جدول الحصص + جدول الحضور */
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

  // ---- 1) جدول حصص النهاردة في الداشبورد ----
  const sessionsTable = page.locator("main table").first();
  const sRows = await sessionsTable.locator("tbody tr").count();
  const sHeads = await sessionsTable.locator("thead th").count();
  console.log("DASH_SESSIONS_TABLE:", JSON.stringify({ rows: sRows, columns: sHeads }));
  await page.screenshot({ path: `${OUT}/test-dash-sessions-table.png` });

  // ---- 2) تحديد كروت متعددة وطباعتها ----
  await page.getByRole("button", { name: "الطلاب" }).click();
  await page.waitForTimeout(1500);

  // ادخل وضع التحديد
  await page.getByRole("button", { name: /تحديد الكروت/ }).click();
  await page.waitForTimeout(400);

  // اختار أول 3 طلاب (grid of cards)
  const cards = page.locator("main .grid > div");
  const cardCount = await cards.count();
  console.log("STUDENT_CARDS_TOTAL:", cardCount);
  const pickN = Math.min(3, cardCount);
  for (let i = 0; i < pickN; i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(150);
  }

  // تأكد إن العدّاد اتحدّث
  const counter = await page.locator("text=طالب محدد").textContent();
  console.log("SELECT_COUNTER:", counter);

  await page.screenshot({ path: `${OUT}/test-students-select.png` });

  // اضغط زرار طباعة الكروت
  await page.evaluate(() => { (window as any).__printCalled = 0; window.print = () => { (window as any).__printCalled++; }; });
  await page.getByRole("button", { name: /طباعة الكروت/ }).click();
  await page.waitForTimeout(1800); // الكروت بتحمّل QR

  // تأكد إن الديالوج فتح وعدّ الكروت صح
  const dialogTitle = await page.locator('[role="dialog"]').getByText(/كارت\)/).textContent().catch(() => null);
  console.log("BULK_DIALOG_TITLE:", dialogTitle);

  // اضغط طباعة جوه الديالوج
  await page.getByRole("button", { name: /طباعة/ }).click();
  await page.waitForTimeout(800);

  // محاكاة print media واعدّ محتوى الجذر
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);

  const printCheck = await page.evaluate(() => {
    const root = document.getElementById("nk-print-root");
    return JSON.stringify({
      printCalled: (window as any).__printCalled,
      cardCount: root?.querySelectorAll(".nk-print-card").length ?? 0,
      gridCols: root ? getComputedStyle(root.querySelector(".nk-print-cards")!).gridTemplateColumns : null,
      headerHidden: (() => { const h = document.querySelector("header.nk-glass-bar") as HTMLElement | null; return !h || getComputedStyle(h).display === "none"; })(),
      title: document.title,
    });
  });
  console.log("BULK_PRINT:", printCheck);
  await page.screenshot({ path: `${OUT}/test-bulk-cards-print.png`, fullPage: true });

  await page.emulateMedia({ media: "screen" });
  await page.waitForTimeout(1800);

  // اقفل ديالوج الكروت
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ---- 3) جدول حضور الحصة ----
  // افتح أول حصة من الداشبورد
  await page.locator("aside").getByRole("button", { name: "الرئيسية" }).click();
  await page.waitForTimeout(1500);
  await page.locator("main table tbody tr").first().click();
  await page.waitForTimeout(2000);

  const attTable = page.locator('[role="dialog"], main').locator("table").last();
  // ممكن يكون جوه الديالوج أو الصفحة — نختبر الـ table الأخير
  const attRows = await attTable.locator("tbody tr").count();
  const attHeads = await attTable.locator("thead th").count();
  console.log("SESSION_ATTENDANCE_TABLE:", JSON.stringify({ rows: attRows, columns: attHeads }));
  await page.screenshot({ path: `${OUT}/test-session-attendance-table.png` });

  console.log("PAGE_ERRORS:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
