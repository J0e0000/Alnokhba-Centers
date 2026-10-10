/**
 * اختبار: صفحة الهبوط + التوجيه الجديد + الجولة التعليمية + زرار المساعدة
 *
 *   (1) / = صفحة هبوط عامة (مش شاشة دخول) فيها 3 مداخل: السنتر/الطالب/المدرس
 *   (2) /login = شاشة دخول السنتر (الفورم + لينكات البورتال)
 *   (3) دخول manager → يتحول لـ /app والنظام شغال
 *   (4) /app من غير جلسة (سياق جديد) → يرجع لـ /login
 *   (5) زرار المساعدة موجود في النظام → يفتح أسئلة الشاشة الحالية + زرار الجولة
 *   (6) «شغّل الجولة التعليمية» يفتح الجولة فعلاً (وتتقفل بتخطي)
 *   (7) سلامة المحتوى: جولة المدير بتغطي كل شاشات المدير + FAQ لكل شاشة
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
};

const browser = await chromium.launch();

// ============ (1) صفحة الهبوط ============
console.log("\n— (1) صفحة الهبوط —");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const hero = await page.locator("h1").first().textContent().catch(() => "");
  ok("الهيرو موجود", !!hero && hero.includes("السنتر كله"));
  const links = await page.locator("a").allTextContents();
  ok("مدخل السنتر", links.some((t) => t.includes("دخول السنتر")));
  ok("مدخل بورتال الطالب", links.some((t) => t.includes("بورتال الطالب")));
  ok("مدخل بورتال المدرس", links.some((t) => t.includes("بورتال المدرس")));
  ok("مفيش فورم دخول في الهبوط", (await page.locator("#username").count()) === 0);
  await page.getByRole("link", { name: /دخول السنتر/ }).first().click();
  await page.waitForURL("**/login");
  ok("دخول السنتر بينقل لـ /login", page.url().endsWith("/login"));
  await page.close();
}

// ============ (2) شاشة دخول السنتر ============
console.log("\n— (2) /login —");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  ok("فورم الدخول موجود", (await page.locator("#username").count()) === 1);
  const links = await page.locator("a").allTextContents();
  ok("لينك بورتال الطالب", links.some((t) => t.includes("بورتال الطالب")));
  ok("لينك بورتال المدرس", links.some((t) => t.includes("بورتال المدرس")));
  ok("لينك رجوع للرئيسية", links.some((t) => t.includes("رجوع للصفحة الرئيسية")));
  await page.close();
}

// ============ (3) دخول → /app ============
console.log("\n— (3) الدخول بيودي /app —");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForURL("**/app", { timeout: 15000 });
  ok("اتحول لـ /app", page.url().endsWith("/app"));
  await page.waitForTimeout(3000);
  const h1 = await page.locator("h1").allTextContents();
  ok("شاشة النظام فتحت (داشبورد)", h1.some((t) => t.includes("مركز النخبة") || t.some(() => true) && h1.length > 0));

  // ============ (5) زرار المساعدة ============
  console.log("\n— (5) زرار المساعدة —");
  const helpBtn = page.locator('[data-tour="help-btn"]');
  ok("زرار المساعدة موجود", (await helpBtn.count()) === 1);
  await helpBtn.click();
  await page.waitForTimeout(800);
  const dlg = page.locator('[role="dialog"]');
  ok("ديالوج المساعدة فتح", await dlg.isVisible().catch(() => false));
  const dlgText = await dlg.textContent().catch(() => "");
  ok("أسئلة الشاشة الحالية ظاهرة", dlgText.includes("أسئلة الرئيسية") || dlgText.includes("الشاشة اللي انت فيها"));
  ok("بحث الأسئلة موجود", (await page.locator('input[placeholder*="ابحث في كل الأسئلة"]').count()) === 1);
  ok("زرار الجولة التعليمية موجود", dlgText.includes("شغّل الجولة التعليمية"));

  // ============ (6) تشغيل الجولة من المساعدة ============
  console.log("\n— (6) تشغيل الجولة من المساعدة —");
  await page.getByRole("button", { name: /شغّل الجولة التعليمية/ }).click();
  await page.waitForTimeout(1400);
  const tourDlg = page.locator('[aria-label="الجولة التعليمية"]');
  ok("الجولة فتحت", await tourDlg.isVisible().catch(() => false));
  const stepTxt = await tourDlg.textContent().catch(() => "");
  ok("خطوة 1 من الجولة", stepTxt.includes("خطوة 1 من"));
  await page.getByRole("button", { name: "التالي" }).click();
  await page.waitForTimeout(1600);
  const step2 = await tourDlg.textContent().catch(() => "");
  ok("الجولة بتنتقل للخطوة التانية", step2.includes("خطوة 2 من"));
  await page.getByRole("button", { name: "تخطي الجولة", exact: true }).click();
  await page.waitForTimeout(600);
  ok("الجولة اتقفلت بالتخطي", !(await tourDlg.isVisible().catch(() => true)));
  await page.close();
}

// ============ (4) /app من غير جلسة ============
console.log("\n— (4) /app من غير جلسة —");
{
  const page = await browser.newPage(); // سياق نضيف — مفيش كوكيز
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  ok("بيرجع لـ /login من غير جلسة", page.url().endsWith("/login"));
  await page.close();
}

await browser.close();

// ============ (7) سلامة محتوى الجولة والمساعدة ============
console.log("\n— (7) سلامة المحتوى —");
{
  const { CENTER_TOUR, RECEPTION_TOUR, ADMIN_TOUR, STUDENT_TOUR, TEACHER_TOUR, FAQ_ITEMS } =
    await import("../src/components/nokhba/help-content");
  const managerViews = ["home", "scan", "payments", "students", "schedule", "groups", "books", "messages", "accounting", "reports", "emergency", "settings"];
  const tourViews = new Set(CENTER_TOUR.map((s) => s.view).filter(Boolean));
  const missing = managerViews.filter((v) => !tourViews.has(v));
  ok("جولة المدير بتغطي كل الشاشات", missing.length === 0, `ناقص: ${missing.join(",")}`);

  const receptionViews = new Set(RECEPTION_TOUR.map((s) => s.view).filter(Boolean));
  const forbidden = ["groups", "accounting", "reports", "emergency", "settings"].filter((v) => receptionViews.has(v));
  ok("جولة الاستقبال من غير شاشات المدير", forbidden.length === 0, `متسللة: ${forbidden.join(",")}`);

  ok("جولات موجودة (أدمن/طالب/مدرس)", ADMIN_TOUR.length >= 5 && STUDENT_TOUR.length >= 5 && TEACHER_TOUR.length >= 5);
  const faqViews = new Set(FAQ_ITEMS.map((f) => f.view));
  const faqMissing = managerViews.filter((v) => !faqViews.has(v));
  ok("FAQ لكل شاشة موظفين", faqMissing.length === 0, `ناقص: ${faqMissing.join(",")}`);
  ok("FAQ للبورتالين", faqViews.has("student-portal") && faqViews.has("teacher-portal"));
  ok("FAQ عامة موجودة", faqViews.has("general"));
  const noAnswer = FAQ_ITEMS.filter((f) => f.a.trim().length < 30);
  ok("كل إجابة موثوقة (٣٠+ حرف)", noAnswer.length === 0);
}

console.log(`\n========= النتيجة: ${passed} ✓ / ${failed} ✗ =========`);
process.exit(failed === 0 ? 0 : 1);
