/**
 * فاحص التباين — الدورة الثانية: الأسطح التفاعلية (ديالوجات/كشك/مساعدة/دفع/بحث سريع)
 * اللي مش بيتعرض غير بعد تفاعل — فاتح + داكن.
 *
 * npx tsx scripts/contrast-audit-pass2.ts
 */
import { chromium, type Page } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/contrast-shots";
const AUDIT_SRC = fs.readFileSync("/home/z/my-project/scripts/audit-fn.js", "utf-8");

type Theme = "light" | "dark";

async function staffLogin(page: Page, user: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.fill("#username", user);
  await page.fill("#password", "nokhba123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/app**", { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate((t) => localStorage.setItem("nk-theme", t), theme);
}

async function scrollPass(page: Page) {
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function auditPage(page: Page, name: string, theme: Theme) {
  await page.waitForTimeout(400);
  const res = await page.evaluate(AUDIT_SRC);
  await page.screenshot({ path: `${OUT_DIR}/${name.replace(/[^\w-]+/g, "_")}${theme === "dark" ? "--dark" : ""}.png`, fullPage: true }).catch(() => {});
  const flag = res.issues.filter((i: any) => !i.disabled).length;
  console.log(`  ${flag === 0 ? "✓" : "✗"} ${name} [${theme}] — ${res.checked} نص · ${flag} مشكلة`);
  if (flag > 0) {
    for (const i of res.issues) {
      console.log(`     ${i.ratio}:1  ${i.fg} → ${i.bg}  ${i.kind}${i.large ? " كبير" : ""}${i.disabled ? " disabled" : ""}`);
      for (const s of i.samples.slice(0, 2)) console.log(`       · ${s.slice(0, 100)}`);
    }
  }
  return res;
}

async function clickVisibleByText(page: Page, label: string | RegExp, exact = false) {
  const cands = page.getByRole("button", { name: label as any, exact });
  const n = await cands.count();
  for (let i = 0; i < n; i++) {
    if (await cands.nth(i).isVisible().catch(() => false)) { await cands.nth(i).click(); return true; }
  }
  const cands2 = page.getByText(label, { exact }).locator("button, a, [role=button]");
  const n2 = await cands2.count();
  for (let i = 0; i < n2; i++) {
    if (await cands2.nth(i).isVisible().catch(() => false)) { await cands2.nth(i).click(); return true; }
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // ============ 1) الهبوط موبايل (فاتح)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    console.log("\n— الهبوط موبايل —");
    await scrollPass(p);
    await auditPage(p, "landing-mobile", "light");
    await ctx.close();
  }

  // ============ 2) المدير: الأسطح التفاعلية (فاتح + داكن)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await staffLogin(p, "manager");

    for (const theme of ["light", "dark"] as Theme[]) {
      console.log(`\n— المدير التفاعلي [${theme}] —`);
      await setTheme(p, theme);
      await p.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(2000);

      // (أ) ديالوج المساعدة (الأسئلة الشائعة) — مجموعات + فتح سؤال
      const helpBtn = p.locator('button[aria-label*="مساعدة"]').first();
      if (await helpBtn.isVisible().catch(() => false)) {
        await helpBtn.click();
        await p.waitForTimeout(900);
        await auditPage(p, "dialog-help", theme);
        // افتح أول مجموعة
        const grp = p.locator("button").filter({ hasText: /الأسئلة|كل|عن الشاشة|عام/ }).first();
        if (await grp.isVisible().catch(() => false)) {
          await grp.click().catch(() => {});
          await p.waitForTimeout(500);
          const q = p.locator("button").filter({ hasText: /؟$/ }).first();
          if (await q.isVisible().catch(() => false)) {
            await q.click().catch(() => {});
            await p.waitForTimeout(900);
            await auditPage(p, "dialog-help-open-answer", theme);
          }
        }
        await p.keyboard.press("Escape");
        await p.waitForTimeout(400);
      }

      // (ب) ديالوج إضافة طالب
      if (await clickVisibleByText(p, "الطلاب")) {
        await p.waitForTimeout(1500);
        if (await clickVisibleByText(p, "إضافة طالب")) {
          await p.waitForTimeout(900);
          await auditPage(p, "dialog-add-student", theme);
          await p.keyboard.press("Escape");
          await p.waitForTimeout(400);
        }
      }

      // (ج) البحث السريع Ctrl+K — مع تحديد عنصر (سطر الـ highlight اللي اتصلح)
      await p.keyboard.press("Control+k");
      await p.waitForTimeout(900);
      await p.keyboard.press("ArrowDown");
      await p.waitForTimeout(300);
      await auditPage(p, "dialog-command-palette", theme);
      await p.keyboard.press("Escape");
      await p.waitForTimeout(400);

      // (د) جرس الإشعارات
      const bell = p.locator('button[aria-label*="الإشعارات"]').first();
      if (await bell.isVisible().catch(() => false)) {
        await bell.click();
        await p.waitForTimeout(800);
        await auditPage(p, "bell-dropdown", theme);
        await p.keyboard.press("Escape");
        await p.waitForTimeout(300);
      }

      // (هـ) مسار الدفع في شاشة المسح: فعّل حصة → اكتب كود طالب → افتح الكارت
      if (await clickVisibleByText(p, "الحضور")) {
        await p.waitForTimeout(1800);
        const chip = p.locator("button").filter({ hasText: /مجموعة|إنجليزي|عربي|رياضة|فيزياء|كيميا/ }).first();
        if (await chip.isVisible().catch(() => false)) {
          await chip.click();
          await p.waitForTimeout(900);
          const inp = p.locator('[data-testid="scan-input"]');
          if (await inp.isVisible().catch(() => false)) {
            await inp.click();
            await inp.fill("10002");
            await p.waitForTimeout(1500);
            await auditPage(p, "scan-search-results", theme);
            // اضغط أول نتيجة
            const result = p.locator("button").filter({ hasText: /محمد|طالب/ }).first();
            if (await result.isVisible().catch(() => false)) {
              await result.click();
              await p.waitForTimeout(1500);
              await auditPage(p, "scan-payment-wizard", theme);
            }
          }
        }
        // اقفل كارت النتيجة (bottom sheet) بزرار الإغلاق بتاعه + Escape للديالوجات
        const xBtns = p.locator('button[aria-label="إغلاق"]');
        const xn = await xBtns.count();
        for (let i = xn - 1; i >= 0; i--) {
          if (await xBtns.nth(i).isVisible().catch(() => false)) { await xBtns.nth(i).click(); await p.waitForTimeout(600); break; }
        }
        for (let i = 0; i < 3; i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
      }

      // (و) وضع الكشك
      if (await clickVisibleByText(p, "الحضور")) {
        await p.waitForTimeout(1500);
        const kioskBtn = p.locator("button").filter({ hasText: "وضع الكشك" }).first();
        if (await kioskBtn.isVisible().catch(() => false)) {
          await kioskBtn.click();
          await p.waitForTimeout(900);
          await auditPage(p, "scan-kiosk", theme);
          const exitBtn = p.locator("button").filter({ hasText: /خروج|إلغاء|رجوع/ }).last();
          if (await exitBtn.isVisible().catch(() => false)) { await exitBtn.click(); await p.waitForTimeout(500); }
          else await p.keyboard.press("Escape");
        }
      }
    }
    await ctx.close();
  }

  await browser.close();
  console.log("\nتم.");
}

main().catch((e) => { console.error(e); process.exit(1); });
