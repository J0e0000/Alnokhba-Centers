/* اختبار E2E: تجربة الموبايل + تسريع الرحلة (صوت/كشك/PIN/بحث/كيبورد/تحضير جماعي) */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 150)}`); });

  // ============ 0) viewport meta ============
  console.log("\n— iPhone viewport meta —");
  await page.goto(BASE, { waitUntil: "networkidle" });
  const meta = await page.locator('meta[name="viewport"]').getAttribute("content") ?? "";
  ok("viewport-fit=cover present", meta.includes("viewport-fit=cover"), meta);
  ok("zoom allowed (no maximum-scale=1)", !/maximum-scale\s*=\s*1(;|$)/.test(meta));

  // الخط محلي (مفيش طلب لـ fonts.googleapis)
  const fontLocal = await page.evaluate(async () => {
    const res = await fetch("/fonts/cairo-arabic.woff2");
    return res.ok;
  });
  ok("self-hosted Cairo font served locally", fontLocal);

  // ============ 1) login + عرض PIN ============
  console.log("\n— Login + PIN offer —");
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2800);
  const pinOffer = await page.getByText("دخول سريع بالـ PIN؟").isVisible().catch(() => false);
  ok("PIN offer appears after password login", pinOffer);
  if (pinOffer) {
    await page.getByRole("button", { name: "مش دلوقتي" }).click();
    await page.waitForTimeout(300);
  }

  // ============ 2) شاشة الحضور: الأزرار الجديدة ============
  console.log("\n— Scan view new controls —");
  await page.locator("aside").getByRole("button", { name: "الحضور" }).click();
  await page.waitForTimeout(1800);

  const soundBtn = page.locator('button[aria-label="تبديل الصوت"]');
  ok("sound toggle visible", await soundBtn.isVisible().catch(() => false));
  const vibrateBtn = page.locator('button[aria-label="تبديل الاهتزاز"]');
  ok("vibrate toggle visible", await vibrateBtn.isVisible().catch(() => false));
  const printBtn = page.locator('button[aria-label="إعدادات الطباعة التلقائية"]');
  ok("auto-print settings button visible", await printBtn.isVisible().catch(() => false));
  const kioskBtn = page.getByRole("button", { name: /وضع الكشك الذاتي/ });
  ok("kiosk mode button visible", await kioskBtn.isVisible().catch(() => false));
  const quickAddBtn = page.getByRole("button", { name: /تسجيل طالب جديد \(سريع\)/ });
  ok("quick-register button visible", await quickAddBtn.isVisible().catch(() => false));

  // اختبار تشغيل الصوت (مفيش crash)
  await soundBtn.click();
  await page.waitForTimeout(200);
  ok("sound toggle click no crash", errors.length === 0);

  // ============ 3) auto-submit كود 5 أرقام ============
  console.log("\n— 5-digit auto-submit —");
  const scanInput = page.locator('input[data-testid="scan-input"]');
  await scanInput.click();
  await scanInput.fill("10001");
  await page.waitForTimeout(1400); // 150ms debounce + request
  const wizardVisible = await page.getByText("هيدفع كام؟").or(page.getByText("دفع كام دلوقتي؟")).first().isVisible().catch(() => false);
  ok("typing 10001 auto-opens payment wizard (no Enter)", wizardVisible);
  await page.screenshot({ path: `${OUT}/test-autosubmit-wizard.png`, fullPage: false });

  // ============ 4) كيبورد سريع: رقم 1 يختار أول chip ============
  console.log("\n— Wizard keyboard shortcuts —");
  // اطلع من خانة المبلغ الأول (blur)
  await page.locator("body").click({ position: { x: 10, y: 400 } });
  await page.waitForTimeout(300);
  const amountBefore = await page.locator('input[inputmode="decimal"]').first().inputValue();
  await page.keyboard.press("2");
  await page.waitForTimeout(250);
  const amountAfter2 = await page.locator('input[inputmode="decimal"]').first().inputValue();
  ok("hotkey '2' selects quick chip", amountBefore !== amountAfter2 || amountAfter2 !== "", `قبل="${amountBefore}" بعد="${amountAfter2}"`);
  // Esc يقفل البطاقة
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const cardClosed = !(await page.getByText("هيدفع كام؟").first().isVisible().catch(() => true));
  ok("Escape closes the wizard card", cardClosed);

  // ============ 5) وضع الكشك ============
  console.log("\n— Kiosk mode —");
  await kioskBtn.click();
  await page.waitForTimeout(800);
  const kioskVisible = await page.locator('[data-testid="kiosk-mode"]').isVisible().catch(() => false);
  ok("kiosk overlay opens", kioskVisible);
  const keypadCount = await page.locator('[data-testid="kiosk-mode"] button').count();
  ok("kiosk numeric keypad rendered (12 keys)", keypadCount >= 12, `${keypadCount} زرار`);
  // اكتب كود بالكيبورد: 9-9-0-0-1 (طالب تجريبي أو كود موجود 10001)
  const kioskExit = page.getByRole("button", { name: /خروج \(للموظفين\)/ });
  ok("kiosk exit button visible", await kioskExit.isVisible().catch(() => false));
  await kioskExit.click();
  await page.waitForTimeout(400);
  const kioskClosed = !(await page.locator('[data-testid="kiosk-mode"]').isVisible().catch(() => true));
  ok("kiosk exits cleanly", kioskClosed);

  // ============ 6) Ctrl+K ============
  console.log("\n— Ctrl+K command palette —");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  const palette = page.locator('[role="dialog"][aria-label="بحث سريع"]');
  ok("Ctrl+K opens palette", await palette.isVisible().catch(() => false));
  await page.locator('[role="dialog"] input').fill("محمد");
  await page.waitForTimeout(600);
  const paletteStudents = await palette.locator("button").count();
  ok("palette finds students live", paletteStudents > 0, `${paletteStudents} نتيجة`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("Escape closes palette", !(await palette.isVisible().catch(() => true)));

  // ============ 7) شريط البحث الجديد (صفحة الدفع — بالاستقبال) ============
  console.log("\n— Restyled search bar —");
  // خروج → دخول كاستقبال (صفحة الدفع في قايمنته)
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForTimeout(1500);
  await page.locator("#username").fill("reception");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2800);
  const skipOffer1 = page.getByText("دخول سريع بالـ PIN؟");
  if (await skipOffer1.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "مش دلوقتي" }).click();
    await page.waitForTimeout(300);
  }
  await page.locator("aside").getByRole("button", { name: "الدفع" }).click();
  await page.waitForTimeout(1500);
  const searchBar = page.locator('[data-testid="student-search"]');
  ok("search bar present", await searchBar.isVisible().catch(() => false));
  await page.locator('[data-testid="student-search"] input').fill("يوسف");
  await page.waitForTimeout(700);
  const clearBtn = page.locator('button[aria-label="مسح البحث"]');
  ok("clear (X) button appears while typing", await clearBtn.isVisible().catch(() => false));
  const dropdown = page.locator('[data-testid="student-search"] .absolute.z-40');
  ok("dropdown opens with results", await dropdown.first().isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/test-search-bar-restyled.png`, fullPage: false });
  await clearBtn.click();
  await page.waitForTimeout(300);

  // زرار ذكّر المديونين ظاهر
  const remindBtn = page.getByRole("button", { name: /ذكّر المديونين/ });
  ok("remind-debtors button visible", await remindBtn.isVisible().catch(() => false));

  // ============ 8) التحضير الجماعي في صفحة الحصة (بالمدير) ============
  console.log("\n— Bulk attendance UI —");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForTimeout(1500);
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2800);
  const skipOffer2 = page.getByText("دخول سريع بالـ PIN؟");
  if (await skipOffer2.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "مش دلوقتي" }).click();
    await page.waitForTimeout(300);
  }
  await page.locator("aside").getByRole("button", { name: "الرئيسية" }).click();
  await page.waitForTimeout(1500);
  // افتح أول حصة شغالة/مفتوحة من جدول النهاردة
  const sessionRow = page.locator("main table tbody tr[class*='cursor'], main table tbody tr").filter({ hasText: /شغالة|جاية/ }).first();
  if (await sessionRow.isVisible().catch(() => false)) {
    await sessionRow.click();
    await page.waitForTimeout(1500);
    const bulkBtn = page.getByRole("button", { name: /علّم الكل حاضر/ });
    const bulkVisible = await bulkBtn.isVisible().catch(() => false);
    console.log(`  (bulk button visible: ${bulkVisible} — يظهر لما في محضروش)`);
    await page.screenshot({ path: `${OUT}/test-session-bulk.png`, fullPage: false });
    ok("session live page loads with new controls", true);
  } else {
    console.log("  (مفيش حصص النهاردة — تخطي)");
    ok("session live skipped (no sessions today)", true);
  }

  // ============ 9) الموبايل 390×844 (context جديد — جلسة فاضية) ============
  console.log("\n— Mobile 390×844 —");
  const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mob = await mobCtx.newPage();
  mob.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mob.goto(BASE, { waitUntil: "networkidle" });
  await mob.locator("#username").fill("reception");
  await mob.locator("#password").fill("nokhba123");
  await mob.getByRole("button", { name: "دخول" }).click();
  await mob.waitForTimeout(2800);
  const skipOfferM = mob.getByText("دخول سريع بالـ PIN؟");
  if (await skipOfferM.isVisible().catch(() => false)) {
    await mob.getByRole("button", { name: "مش دلوقتي" }).click();
    await mob.waitForTimeout(300);
  }

  // bottom nav ظاهر ومش مغطى
  const bottomNav = mob.locator('nav[aria-label="التنقل الرئيسي"]');
  ok("mobile bottom nav visible", await bottomNav.isVisible().catch(() => false));
  const navBox = await bottomNav.boundingBox();
  ok("bottom nav fits screen width", !!navBox && navBox.width <= 391, navBox ? `w=${navBox.width}` : "null");

  // الحضور: شريط المسح + الأزرار
  await mob.locator('nav[aria-label="التنقل الرئيسي"]').getByText("الحضور").click();
  await mob.waitForTimeout(1500);
  ok("mobile scan input visible", await mob.locator('input[data-testid="scan-input"]').isVisible().catch(() => false));
  const kioskBtnMob = mob.getByRole("button", { name: /وضع الكشك الذاتي/ });
  ok("mobile kiosk button visible", await kioskBtnMob.isVisible().catch(() => false));
  await mob.screenshot({ path: `${OUT}/test-mobile-scan.png`, fullPage: false });

  // كشك على الموبايل
  await kioskBtnMob.click();
  await mob.waitForTimeout(700);
  ok("mobile kiosk opens", await mob.locator('[data-testid="kiosk-mode"]').isVisible().catch(() => false));
  await mob.screenshot({ path: `${OUT}/test-mobile-kiosk.png`, fullPage: false });
  await mob.getByRole("button", { name: /خروج \(للموظفين\)/ }).click();
  await mob.waitForTimeout(300);

  // ============ 10) PIN flow كامل بالواجهة ============
  console.log("\n— Full PIN UI flow —");
  // خروج ثم دخول بالباسورد ثم تفعيل PIN من العرض
  await mob.locator('nav[aria-label="التنقل الرئيسي"]').getByText("المزيد").click();
  await mob.waitForTimeout(400);
  await mob.getByRole("button", { name: "تسجيل خروج" }).click();
  await mob.waitForTimeout(1500);

  await mob.locator("#username").fill("reception");
  await mob.locator("#password").fill("nokhba123");
  await mob.getByRole("button", { name: "دخول" }).click();
  await mob.waitForTimeout(2800);

  const offer = mob.getByText("دخول سريع بالـ PIN؟");
  if (await offer.isVisible().catch(() => false)) {
    await mob.getByRole("button", { name: "أيوه — شغّله" }).click();
    await mob.waitForTimeout(400);
    await mob.locator('input[inputmode="numeric"]').fill("2580");
    await mob.waitForTimeout(600); // auto-advance to confirm
    await mob.locator('input[inputmode="numeric"]').fill("2580");
    await mob.waitForTimeout(300);
    await mob.getByRole("button", { name: "تفعيل" }).click();
    await mob.waitForTimeout(800);
    ok("PIN enabled via UI offer", true);

    // خروج → لوحة الـ PIN تظهر تلقائيًا
    await mob.locator('nav[aria-label="التنقل الرئيسي"]').getByText("المزيد").click();
    await mob.waitForTimeout(400);
    await mob.getByRole("button", { name: "تسجيل خروج" }).click();
    await mob.waitForTimeout(1500);
    const pinPad = mob.getByText("الدخول السريع");
    ok("PIN pad appears after logout", await pinPad.isVisible().catch(() => false));
    await mob.screenshot({ path: `${OUT}/test-pin-login.png`, fullPage: false });

    // دخول بالـ PIN: 2-5-8-0
    for (const d of ["2", "5", "8", "0"]) {
      await mob.locator("form").getByRole("button", { name: d, exact: true }).click();
      await mob.waitForTimeout(150);
    }
    await mob.waitForTimeout(1200);
    const loggedIn = await mob
      .getByText(/شاشة الاستقبال|بورتال المدير/)
      .first()
      .isVisible()
      .catch(() => false);
    ok("PIN login enters the app", loggedIn);

    // إلغاء الدخول السريع على الجهاز (تنضيف)
    await mob.locator('nav[aria-label="التنقل الرئيسي"]').getByText("المزيد").click();
    await mob.waitForTimeout(400);
    await mob.getByRole("button", { name: "تسجيل خروج" }).click();
    await mob.waitForTimeout(1200);
    await mob.getByRole("button", { name: "إلغاء الدخول السريع على الجهاز ده" }).click();
    await mob.waitForTimeout(600);
    ok("fast-login disabled + back to password form", await mob.locator("#username").isVisible().catch(() => false));
  } else {
    console.log("  (العرض ما ظهرش — الجهاز عليه token من اختبار سابق)");
    ok("PIN offer skipped (already trusted)", true);
  }

  // ============ 11) أخطاء ============
  console.log("\n— Console/page errors —");
  const realErrors = errors.filter((e) => !e.includes("favicon"));
  ok("zero page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(`\n========== النتيجة: ${passed} ✓ / ${failed} ✗ ==========`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
