/* فحص DOM مباشر: إيه اللي بيظهر فعلاً بعد دخول الـ PIN؟ */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // دخول بكلمة السر
  await page.goto(`${BASE}/`);
  await page.locator("#username").fill("reception");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2500);

  // فعّل PIN
  const offer = page.getByText("دخول سريع بالـ PIN؟");
  if (await offer.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "أيوه — شغّله" }).click();
    await page.waitForTimeout(500);
    await page.locator('input[inputmode="numeric"]').fill("2580");
    await page.waitForTimeout(700);
    await page.locator('input[inputmode="numeric"]').fill("2580");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "تفعيل" }).click();
    await page.waitForTimeout(900);
  }

  // خروج
  await page.locator('button[aria-label="تسجيل الخروج"]').click();
  await page.waitForTimeout(1800);

  // دخول بالـ PIN
  for (const d of ["2", "5", "8", "0"]) {
    await page.locator("form").getByRole("button", { name: d, exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.locator("form button[type=submit]").click();
  await page.waitForTimeout(2500);

  // dump النص الفعلي للصفحة
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log("===== BODY TEXT AFTER PIN LOGIN =====");
  console.log(bodyText);

  // عدد الـ headers ومحتواها
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll("header")).map((h) => (h as HTMLElement).innerText.slice(0, 100))
  );
  console.log("===== HEADERS (" + headers.length + ") =====");
  headers.forEach((h, i) => console.log(`[header ${i}]`, JSON.stringify(h)));

  const url = page.url();
  console.log("URL:", url);

  // تنظيف
  await page.locator('button[aria-label="تسجيل الخروج"]').click().catch(() => {});
  await page.waitForTimeout(1500);
  const disableBtn = page.getByRole("button", { name: "إلغاء الدخول السريع على الجهاز ده" });
  if (await disableBtn.isVisible().catch(() => false)) await disableBtn.click();

  await browser.close();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
