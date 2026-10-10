/* اختبار سريع: التحقق من ظهور الـ dropdown بعد البحث بالاسم */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 768, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0,150)}`); });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /مدير — مركز النخبة/ }).click();
  await page.waitForTimeout(2000);

  await page.locator("aside").getByRole("button", { name: "الحضور" }).click();
  await page.waitForTimeout(1500);

  // صورة قبل الكتابة
  await page.screenshot({ path: "/home/z/my-project/download/test-scan-empty.png" });

  const searchInput = page.locator('input[placeholder*="ابحث بالاسم"]');
  await searchInput.click();
  await searchInput.fill("محمد");
  await page.waitForTimeout(800);

  // dump HTML structure
  const dropdownHTML = await page.locator('div.absolute.z-30').first().innerHTML().catch(() => "<empty>");
  console.log("DROPDOWN_HTML_LENGTH:", dropdownHTML.length);
  console.log("DROPDOWN_HTML_PREVIEW:", dropdownHTML.slice(0, 400));

  // input value
  const val = await searchInput.inputValue();
  console.log("INPUT_VALUE:", val);

  await page.screenshot({ path: "/home/z/my-project/download/test-scan-dropdown.png" });
  console.log("ERRORS:", errors.length ? errors : "none");
  await browser.close();
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
