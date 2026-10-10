/* ============================================================
   تحقق كامل لتدفق الـ PIN: تفعيل → خروج → دخول بالـ PIN
   (تشخيص فشل اختبار "PIN login enters the app")
============================================================ */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // 1) دخول بكلمة السر
  await page.goto(`${BASE}/`);
  await page.locator("#username").fill("reception");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2500);

  // 2) عرض الـ PIN → اقبل وفعّل 2580
  const offer = page.getByText("دخول سريع بالـ PIN؟");
  if (await offer.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "أيوه — شغّله" }).click();
    await page.waitForTimeout(500);
    await page.locator('input[inputmode="numeric"]').fill("2580");
    await page.waitForTimeout(700); // auto-advance to confirm
    await page.locator('input[inputmode="numeric"]').fill("2580");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "تفعيل" }).click();
    await page.waitForTimeout(900);
    console.log("PIN 2580 enabled ✓");
  } else {
    console.log("لا يوجد عرض PIN (الجهاز متفعّل قبل كده؟)");
  }

  // 3) انتظر الهيدر الحقيقي
  await page.locator("header").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const h1 = await page.locator("header").innerText().catch(() => "");
  console.log("HEADER after login:", JSON.stringify(h1.replace(/\n/g, " | ")));

  // 4) خروج
  await page.locator('button[aria-label="تسجيل الخروج"]').click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/debug-pin-pad.png` });

  const pinPad = page.locator("h2", { hasText: "الدخول السريع" });
  console.log("PIN pad visible after logout:", await pinPad.isVisible().catch(() => false));

  // 5) دخول بالـ PIN 2580
  for (const d of ["2", "5", "8", "0"]) {
    await page.locator("form").getByRole("button", { name: d, exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.locator("form button[type=submit]").click();
  await page.waitForTimeout(2200);

  // 6) اتأكد إننا جوّه التطبيق (الهيدر أو المحتوى)
  const h2 = await page.locator("header").innerText().catch(() => "");
  console.log("HEADER after PIN login:", JSON.stringify(h2.replace(/\n/g, " | ")));
  const navVisible = await page.locator('nav[aria-label="التنقل الرئيسي"]').isVisible().catch(() => false);
  const inApp = /شاشة الاستقبال|بورتال المدير|نخبة سنترز/.test(h2) && navVisible;
  console.log(">>> PIN LOGIN RESULT — entered app:", inApp);
  await page.screenshot({ path: `${OUT}/debug-pin-result.png` });

  console.log("PAGE ERRORS:", errors.length === 0 ? "صفر ✓" : errors.slice(0, 5));

  // 7) تنظيف: خروج + إلغاء الدخول السريع
  await page.locator('button[aria-label="تسجيل الخروج"]').click();
  await page.waitForTimeout(1500);
  const disableBtn = page.getByRole("button", { name: "إلغاء الدخول السريع على الجهاز ده" });
  if (await disableBtn.isVisible().catch(() => false)) {
    await disableBtn.click();
    await page.waitForTimeout(800);
    console.log("cleanup: fast-login disabled on this device ✓");
  }

  await browser.close();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
