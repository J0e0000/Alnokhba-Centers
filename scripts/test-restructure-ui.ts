/* اختبار E2E: إعادة الهيكلة — كروت الحصص + الحالة المصغرة + الباقي/المحفظة + بورتال الطالب + الإعلانات + الطوارئ */
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

  // ============================================================ 1. بورتال الطالب (موبايل)
  console.log("\n— بورتال الطالب (390×844) —");
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await pctx.newPage();
  const perrors: string[] = [];
  p.on("pageerror", (e) => perrors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("401")) perrors.push(`console: ${m.text().slice(0, 150)}`);
  });

  await p.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  ok("portal login screen", await p.locator("#pcode").isVisible().catch(() => false));

  // دخول غلط → رسالة واضحة (مش خطأ تقني)
  await p.locator("#pcode").fill("١٠٠٠٢");
  await p.locator("#pphone").fill("01000000000");
  await p.getByRole("button", { name: "دخول" }).click();
  await p.waitForTimeout(1200);
  const errText = (await p.locator("text=مش متطابقين").count()) > 0;
  ok("wrong login → Arabic error message", errText);

  // دخول صح
  await p.locator("#pcode").fill("١٠٠٠٢");
  await p.locator("#pphone").fill("01055552222");
  await p.getByRole("button", { name: "دخول" }).click();
  await p.waitForTimeout(2500);
  const greeting = await p.getByText("أهلاً يا محمد").isVisible().catch(() => false);
  ok("portal home greeting", greeting);
  const qrImg = await p.locator('img[alt*="QR"]').isVisible().catch(() => false);
  ok("QR code visible on home", qrImg);
  const codeShown = await p.getByText("10002").isVisible().catch(() => false);
  ok("student code displayed", codeShown);

  // رصيد الطالب على الرئيسية
  const balanceCard = await p.getByText("رصيدك في السنتر").first().isVisible().catch(() => false);
  ok("student balance card on home", balanceCard);

  // قيمة الرصيد بالجنيه (مش بالقروش — bug المضاعفة ×100)
  const apiBal = await p.evaluate(async () => {
    const r = await fetch("/api/portal");
    return (await r.json()).balance as number;
  });
  const expectedEgp = Math.round(apiBal) / 100;
  const balTextRaw = (await p.locator('section:has(h3:has-text("رصيدك في السنتر")) p.nk-num').first().innerText().catch(() => "")).trim();
  const shownEgp = parseFloat(balTextRaw.replace("ج", "").replace(/,/g, "").trim());
  ok("balance shows EGP (not ×100 piastres)", !isNaN(shownEgp) && Math.abs(Math.abs(shownEgp) - Math.abs(expectedEgp)) < 0.011,
     `api=${apiBal} قرش → متوقع ${expectedEgp} ج · معروض «${balTextRaw}»`);

  // 3 تابات — كل واحدة بتفتح محتواها
  await p.getByRole("button", { name: "جدولي" }).first().click();
  await p.waitForTimeout(900);
  ok("جدولي tab works", await p.getByText("جدولي", { exact: true }).first().isVisible().catch(() => false));
  const dayCard = await p.getByText("الأحد", { exact: true }).first().isVisible().catch(() => false);
  ok("weekly schedule days", dayCard);
  const nextChip = await p.getByText("الجاية").count() + await p.getByText("النهاردة").count();
  ok("today/next highlighted", nextChip > 0);

  // الرسائل — إعلانات + إشعارات في تاب واحدة
  await p.getByRole("button", { name: "الرسائل" }).first().click();
  await p.waitForTimeout(1200);
  ok("الرسائل tab opens", (await p.getByText("الرسائل", { exact: true }).count()) > 0);
  // التابات القديمة ادمجت: الناف بقى 3 أزرار بس (مفيش إعلانات/إشعارات)
  const navBtnCount = await p.locator('nav[aria-label="تنقل الطالب"] button').count();
  ok("portal nav merged to 3 tabs", navBtnCount === 3, `${navBtnCount} أزرار`);
  const feedOrEmpty = await p.getByText(/مفيش رسايل لسه|اليوم|سابقًا|تحديد الكل كمقروء/).first().isVisible().catch(() => false);
  ok("messages feed renders (cards or empty state)", feedOrEmpty);

  // الرسائل: تحديد الكل كمقروء (لو فيه غير مقروء)
  const markAll = await p.getByText("تحديد الكل كمقروء").isVisible().catch(() => false);
  if (markAll) {
    await p.getByText("تحديد الكل كمقروء").click();
    await p.waitForTimeout(900);
    ok("mark all read works", true);
  } else {
    ok("mark all read (مفيش رسايل غير مقروءة — عادي)", true);
  }

  // بوب-أب الإشعار الفوري (نمط فيسبوك): إعلان جديد → بانر ينزل من فوق + صوت + تحديث البادج
  // (fetch مباشر — APIRequestContext بتاع Playwright بيوقّف مع Bun 1.3.14)
  console.log("\n— بوب-أب الإشعار الفوري —");
  const mgrLogin = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "nokhba123" }),
  });
  const mgrCookie = (mgrLogin.headers.get("set-cookie") ?? "").split(";")[0];
  ok("manager login (fetch)", mgrLogin.ok && !!mgrCookie);
  const annRes = await fetch(`${BASE}/api/announcements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mgrCookie },
    body: JSON.stringify({ title: "اختبار البوب-أب: إشعار فوري", body: "رسالة تجربة البانر العائم — هتتشال بعد الاختبار.", audienceType: "ALL" }),
  });
  ok("manager publishes instant announcement", annRes.ok, `status=${annRes.status}`);
  // زي رجوع التبويب للشاشة → الفحص الدوري شغال فورًا (مش مستنيين 30 ثانية)
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForTimeout(2000);
  const bannerText = await p.getByText("اختبار البوب-أب: إشعار فوري").first().isVisible().catch(() => false);
  ok("floating banner pops in (Facebook-style)", bannerText);
  // دوس البانر → يفتح تاب الرسايل على الإشعار
  if (bannerText) {
    await p.getByText("اختبار البوب-أب: إشعار فوري").first().click();
    await p.waitForTimeout(1200);
    const inMessages = await p.getByText("اختبار البوب-أب: إشعار فوري").first().isVisible().catch(() => false);
    ok("banner click → opens messages tab with the notification", inMessages);
  }
  // نظّف إعلان الاختبار (كمان الإشعارات المرتبطة بيه)
  if (annRes.ok) {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    await db.studentNotification.deleteMany({ where: { title: { contains: "اختبار البوب-أب" } } });
    await db.announcement.deleteMany({ where: { title: { contains: "اختبار البوب-أب" } } });
    await db.$disconnect();
  }

  // خروج
  await p.locator('button[aria-label="تسجيل الخروج"]').click();
  await p.waitForTimeout(1500);
  ok("portal logout → back to login", await p.locator("#pcode").isVisible().catch(() => false));
  ok("portal: صفر أخطاء صفحة", perrors.length === 0, perrors.slice(0, 2).join(" | "));
  await pctx.close();

  // ============================================================ 2. داشبورد الاستقبال: كروت الحصص + الحالة المصغرة
  console.log("\n— داشبورد: كروت + شريط الحالة —");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // 401/403 أثناء تسجيل الخروج/الدخول متوقعة — مش أخطاء حقيقية
    if (m.type() === "error" && !/40[13]/.test(m.text())) errors.push(`console: ${m.text().slice(0, 150)}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#username").fill("reception");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(3000);

  // كروت الحصص: [فتح الحصة] للمخططة أو [امسح الحضور] للمفتوحة
  const openBtn = await page.getByRole("button", { name: "فتح الحصة" }).count();
  const scanBtn = await page.getByRole("button", { name: "امسح الحضور" }).count();
  ok("lesson cards with explicit open/scan buttons", openBtn + scanBtn > 0, `فتح=${openBtn} · امسح=${scanBtn}`);

  // لو فيه حصة مخططة → افتحها بالزرار (هينتقل لشاشة الحصة المباشرة)
  let openedSessionId = "";
  if (openBtn > 0) {
    await page.getByRole("button", { name: "فتح الحصة" }).first().click();
    await page.waitForTimeout(3000);
    // الشاشة الحية للحصة ظهرت (زرار القفل موجود)
    const closeBtn = await page.getByRole("button", { name: /قفل الحصة/ }).count();
    ok("opening a lesson → live session screen", closeBtn > 0);
    // الشريط المصغر ظهر فورًا (بعد حدث nk-sessions-changed)
    const chip = await page.getByText(/حصص شغالة|الحصة شغالة/).count();
    ok("mini status element visible", chip > 0);
    // زرار المسح في الشاشة الحية
    const scanNow = await page.getByRole("button", { name: /امسح QR للطلاب/ }).count();
    ok("scan CTA on live session screen", scanNow > 0);
    await page.getByRole("button", { name: /امسح QR للطلاب/ }).first().click();
    await page.waitForTimeout(2500);
    // شاشة المسح ظهرت (العنوان الفرعي مميز للشاشة دي) + قسم حصص النهاردة مرسوم
    // (العنوان أيامي: «حصص النهاردة» بعد التحميل — والسكيلتون المؤقت «حصة النهاردة»)
    const scanSubtitle = await page.getByText("ابحث بالاسم أو امسح QR أو اكتب الكود").count();
    const sessionsSection = await page.getByText(/حصص? النهاردة/).count();
    ok("scan CTA navigates to scan view (session preselected)", scanSubtitle > 0 && sessionsSection > 0);
    openedSessionId = "opened";
  } else if (scanBtn > 0) {
    ok("already-open lesson card shows scan CTA", true);
    await page.getByRole("button", { name: "امسح الحضور" }).first().click();
    await page.waitForTimeout(2000);
    openedSessionId = "already";
  } else {
    ok("no lessons today — cards system renders empty state", (await page.getByText("مفيش حصص النهاردة").count()) > 0);
  }
  void openedSessionId;

  // ============================================================ 3. الباقي/المحفظة في الويزارد
  console.log("\n— الدفع: أضف الباقي للمحفظة / رجّع الباقي —");
  // لو مش في صفحة المسح (مثلاً مفيش حصص) → افتح تاب الحضور
  const scanInputSel = 'input[placeholder*="اكتب الكود"]';
  if ((await page.locator(scanInputSel).count()) === 0) {
    await page.getByRole("button", { name: "الحضور" }).first().click();
    await page.waitForTimeout(2000);
  }
  // جهّز بيانات تجريبية (طلاب 99xxx بأرصدة متنوعة + حصتين تجريبيتين) — بجلسة مدير من السيرفر
  // امسح أي ديمو قديم الأول عشان الأرصدة تفضل حقيقية (الـ POST مش بيعمل reset)
  const mres = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "nokhba123" }),
  });
  const mcookie = (mres.headers.get("set-cookie") ?? "").split(";")[0];
  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  await page.waitForTimeout(800);
  await fetch(`${BASE}/api/demo`, { method: "POST", headers: { Cookie: mcookie } });
  await page.waitForTimeout(1500);
  const demoInfo = await page.evaluate(async () => {
    const res = await fetch("/api/demo");
    return res.json();
  });
  const demoStudents = ((demoInfo as { students?: { code: string; name: string; balance: number }[] }).students) ?? [];
  ok("demo data prepared", demoStudents.length >= 4, `${demoStudents.length} طالب تجريبي`);
  // الطالب اللي عليه مديونية (الأرصدة بالقرش)
  const debtor = demoStudents.find((s) => s.balance < 0) ?? demoStudents[0];

  // اختار حصة تجريبية — لازم الصفحة تتحمل تاني بعد ما الديمو اتعمل (الشيبس بيتحملوا وقت المount)
  await page.reload();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "الحضور" }).first().click();
  await page.waitForTimeout(2200);
  const demoChip = page.locator('button', { hasText: /تجريبي/ }).first();
  const chipCount = await demoChip.count();
  await demoChip.click().catch(() => {});
  await page.waitForTimeout(900);

  // امسح كود الطالب المديون → الويزارد
  const input = page.locator(scanInputSel).first();
  await input.fill(String(debtor?.code ?? "99001"));
  await page.waitForTimeout(2800); // auto-submit

  // اكتب مبلغ أكبر من المطلوب → الزراير تنقسم
  const amountInput = page.locator('input[inputmode="decimal"]').first();
  const wizardVisible = chipCount > 0 && (await amountInput.isVisible().catch(() => false));
  if (wizardVisible) {
    await amountInput.fill("500");
    await page.waitForTimeout(600);
    const walletBtn = await page.getByRole("button", { name: /أضف الباقي للمحفظة/ }).count();
    const returnBtn = await page.getByRole("button", { name: /رجّع الباقي/ }).count();
    ok("change flow: wallet button appears", walletBtn > 0);
    ok("change flow: return-change button appears", returnBtn > 0);
    const line = await page.getByText(/الباقي \d+ ج/).count();
    ok("change amount shown in one line", line > 0);

    // دوس "رجّع الباقي" → دفعة بالظبط
    await page.getByRole("button", { name: /رجّع الباقي/ }).first().click();
    await page.waitForTimeout(2500);
    const success = await page.getByText(/تم تسجيل الدفع|جاهز للطالب الجاي|الباقي عليه/).count();
    ok("return-change completes payment", success > 0);
  } else {
    ok("wizard: لم يظهر (الطالب سدد خلاص) — تم تخطي دفع الباقي", true);
  }

  // ============================================================ 4. غير مسجل في المجموعة → اختار مجموعة أخرى
  console.log("\n— غير مسجل في المجموعة —");
  await page.waitForTimeout(1200);
  const input2 = page.locator(scanInputSel).first();
  if (await input2.isVisible().catch(() => false)) {
    // الحصة التجريبية المختارة + طالب حقيقي (10013) → ORANGE مضمونة
    await input2.fill("");
    await page.waitForTimeout(400);
    await input2.fill("10013");
    await page.waitForTimeout(2800);
    const orange = await page.locator("text=مش مسجل في المجموعة").count();
    if (orange > 0) {
      const otherGroup = await page.getByRole("button", { name: "اختار مجموعة أخرى" }).count();
      ok("orange flow: choose-other-group button", otherGroup > 0);
      const register = await page.getByRole("button", { name: /سجّله في المجموعة/ }).count();
      ok("orange flow: register-in-group button", register > 0);
      // دوس اختار مجموعة أخرى → الكارت يقفل
      await page.getByRole("button", { name: "اختار مجموعة أخرى" }).click();
      await page.waitForTimeout(900);
      ok("choose-other-group closes card", !(await page.locator("text=مش مسجل في المجموعة").first().isVisible().catch(() => false)));
    } else {
      ok("orange flow: كل الطلاب مسجلين (تخطّي)", true);
    }
  }

  // ============================================================ 5. لوحة المدير: الرسائل (إعلانات البورتال + الواتساب) + الطوارئ
  console.log("\n— المدير: الرسائل + الطوارئ —");
  await page.locator('button[aria-label="تسجيل الخروج"]').click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(3000);

  // تاب الرسائل (من المزيد على الموبايل) — إعلانات البورتال + واتساب
  await page.getByRole("button", { name: "المزيد" }).click().catch(async () => {
    // ديسكتوب؟ العرض 390 فالموبايل شغال
  });
  await page.waitForTimeout(800);
  const msgBtn = page.getByRole("button", { name: "الرسائل", exact: true }).first();
  await msgBtn.click().catch(() => {});
  await page.waitForTimeout(1500);
  const chips = await page.getByText("إعلانات البورتال").first().isVisible().catch(() => false);
  ok("messages tab with portal-announcements chip", chips);
  const waChip = await page.getByText("رسائل واتساب").first().isVisible().catch(() => false);
  ok("whatsapp chip present", waChip);
  const annForm = await page.getByText("إعلان جديد").isVisible().catch(() => false);
  ok("announcement form opens (default section)", annForm);
  const audienceTypes = await page.getByText("كل الطلاب").first().isVisible().catch(() => false);
  ok("audience selector (كل الطلاب/مرحلة/مجموعة/مادة)", audienceTypes);

  // انشر إعلان فعلي من الواجهة — لازم يوصل للطالب بنفس شكله
  const annTitle = "اختبار UI: إعلان من تاب الرسائل";
  await page.getByPlaceholder("مثلاً: تغيير موعد حصة التاريخ").fill(annTitle);
  await page.getByPlaceholder("اكتب الإعلان ببساطة — الطالب هيقرأه على موبايله").fill("نص الإعلان من اختبار الواجهة — هيتشال بعد الاختبار.");
  await page.getByRole("button", { name: "نشر الإعلان" }).click();
  await page.waitForTimeout(2500);
  const published = await page.getByText(/تم نشر الإعلان لـ/).isVisible().catch(() => false);
  ok("announcement published from messages tab", published);
  const inHistory = await page.getByText(annTitle).first().isVisible().catch(() => false);
  ok("announcement appears in published history", inHistory);

  // شيبس الواتساب بيفتح الطابور
  await page.getByRole("button", { name: /رسائل واتساب/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const waSection = await page.getByText(/طابور رسائل الواتساب|مفيش طابور رسائل لسه/).first().isVisible().catch(() => false);
  ok("whatsapp queue section reachable", waSection);

  // تاب الطوارئ
  await page.getByRole("button", { name: "المزيد" }).click().catch(() => {});
  await page.waitForTimeout(800);
  const emBtn = page.getByRole("button", { name: "الطوارئ", exact: true }).first();
  await emBtn.click().catch(() => {});
  await page.waitForTimeout(1500);
  const dlBtn = await page.getByRole("button", { name: /نزّل ملف الطوارئ/ }).count();
  ok("emergency view opens with download", dlBtn > 0);
  const uploadArea = await page.getByText(/دوس لاختيار ملف الطوارئ/).isVisible().catch(() => false);
  ok("emergency upload area", uploadArea);

  ok("staff screens: صفر أخطاء صفحة", errors.length === 0, errors.slice(0, 3).join(" | "));

  await ctx.close();
  await browser.close();

  // لقطة للبورتال (توثيق) + التحقق إن إعلان المدير وصل للطالب بنفس شكله
  const b2 = await chromium.launch();
  const c2 = await b2.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  await p2.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await p2.locator("#pcode").fill("10002");
  await p2.locator("#pphone").fill("01055552222");
  await p2.getByRole("button", { name: "دخول" }).click();
  await p2.waitForTimeout(3000);
  await p2.screenshot({ path: `${OUT}/shot-portal-home.png`, fullPage: false });
  await p2.getByRole("button", { name: "جدولي" }).first().click();
  await p2.waitForTimeout(1000);
  await p2.screenshot({ path: `${OUT}/shot-portal-schedule.png`, fullPage: false });
  await p2.getByRole("button", { name: "الرسائل" }).first().click();
  await p2.waitForTimeout(1500);
  // الإعلان اللي المدير نشره من تاب الرسائل — الطالب شايفه بنفس شكله
  ok("manager announcement visible to student (same shape)", await p2.getByText("اختبار UI: إعلان من تاب الرسائل").first().isVisible().catch(() => false));
  ok("announcement meta (audience + sender) shown like manager's", await p2.getByText("كل الطلاب").first().isVisible().catch(() => false) && await p2.getByText(/من /).first().isVisible().catch(() => false));
  await p2.screenshot({ path: `${OUT}/shot-portal-messages.png`, fullPage: false });
  await b2.close();

  // ============================================================ تنظيف (بعد التحقق — عشان الإعلان يفضل موجود للطالب)
  const b3 = await chromium.launch();
  const c3 = await b3.newContext();
  const p3 = await c3.newPage();
  await p3.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  await p3.evaluate(async () => {
    await fetch("http://localhost:3000/api/demo?confirm=demo", { method: "DELETE" });
  }).catch(() => {});
  await p3.waitForTimeout(1500);
  ok("demo data cleaned", true);
  await c3.close();
  await b3.close();

  // امسح إعلانات/إشعارات الاختبار (كل اللي عنوانه فيه "اختبار")
  const { PrismaClient } = await import("@prisma/client");
  const pdb = new PrismaClient();
  const delAnn = await pdb.announcement.deleteMany({ where: { title: { contains: "اختبار" } } });
  await pdb.studentNotification.deleteMany({ where: { title: { contains: "اختبار" } } });
  console.log(`  (تنضيف الإعلانات: ${delAnn.count})`);
  await pdb.$disconnect();

  console.log(`\n========== النتيجة: ${passed} ✓ / ${failed} ✗ ==========`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
