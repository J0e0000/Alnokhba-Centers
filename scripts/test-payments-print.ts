/* اختبار E2E شامل لتحديثات الدفع والطباعة:
   1) صفحة الدفع: بحث → دفع → زراير طباعة ظاهرة → محتوى الإيصال فيه التاريخ والوقت والموظف
   2) طباعة معاملة قديمة من سجل الدفعات (PAYMENT + REFUND)
   3) كشف حساب الطالب: اسم الموظف + زرار طباعة لكل حركة
   4) API: byName في payments + receipts fallback للـ REFUND
*/
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
}

async function login(page: PlaywrightPage, user: string) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill('input[name="username"], input[placeholder*="اسم المستخدم"]', user).catch(() => {});
  // fallback: fill by accessibility
  const boxes = page.locator("input");
  if (await boxes.count() >= 2) {
    await boxes.nth(0).fill(user);
    await boxes.nth(1).fill("nokhba123");
  }
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForTimeout(2500);
  // اقفل عرض الدخول السريع بالـ PIN لو ظهر (مش هدف الاختبار ده)
  const skipPin = page.getByRole("button", { name: "مش دلوقتي" });
  if (await skipPin.isVisible().catch(() => false)) {
    await skipPin.click();
    await page.waitForTimeout(400);
  }
}

type PlaywrightPage = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  const prints: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __prints: string[] }).__prints = [];
    (window as unknown as { print: () => void }).print = function () {
      const root = document.getElementById("nk-print-root");
      const w = window as unknown as { __prints: string[] };
      w.__prints.push(root ? root.innerText : "EMPTY");
    };
  });

  // ============ 1) LOGIN AS RECEPTION ============
  console.log("\n[1] دخول استقبال → صفحة الدفع");
  await login(page, "reception");
  ok("تسجيل دخول استقبال", (await page.locator("header").first().innerText()).includes("سارة"));

  await page.getByRole("button", { name: "الدفع" }).first().click();
  await page.waitForTimeout(2500);
  ok("صفحة الدفع فتحت", await page.getByRole("heading", { name: "الدفع", exact: true }).isVisible());

  const searchBar = page.locator('input[placeholder*="ابحث"]');
  ok("شريط البحث ظاهر", await searchBar.isVisible());

  // سجل الدفعات فيه اسم الموظف
  const bodyText = await page.evaluate(() => document.body.innerText);
  ok("سجل الدفعات بيعرض اسم الموظف (سارة محمد أو أ. أحمد)", bodyText.includes("سارة محمد") || bodyText.includes("أ. أحمد محمود"));
  const printBtns = await page.locator('button[title="طباعة الإيصال"]').count();
  ok(`زرار طباعة لكل معاملة في السجل (${printBtns} زرار)`, printBtns > 0);

  // طباعة أول معاملة من السجل
  await page.locator('button[title="طباعة الإيصال"]').first().click();
  await page.waitForTimeout(2500);
  const p1 = await page.evaluate(() => (window as unknown as { __prints: string[] }).__prints.at(-1) ?? "");
  ok("الطباعة اتفتحت فعلاً", p1.length > 0);
  ok("الإيصال فيه التاريخ والوقت", p1.includes("التاريخ والوقت"));
  ok("الإيصال فيه الموظف المسؤول", p1.includes("الموظف المسؤول"));
  ok("الإيصال فيه اسم مركز النخبة", p1.includes("مركز النخبة"));

  // ============ 2) PAY FLOW ============
  console.log("\n[2] تسجيل دفعة جديدة → زراير الطباعة");
  // لسه في وضع البحث — ابحث على طول
  await page.locator('input[placeholder*="ابحث"]').fill("10004");
  await page.waitForTimeout(1800);
  const hit = page.getByRole("button", { name: /يوسف/ }).first();
  await hit.click();
  await page.waitForTimeout(2500);
  const panel = await page.evaluate(() => document.body.innerText);
  ok("بانل الدفع فتح للطالب", panel.includes("دفع — يوسف"));

  // ادفع المطلوب بالظبط (زرار «المطلوب» السريع) → زر واحد «تم الدفع»
  // (لو مفيش مديونية: أي مبلغ — الزر يفضل واحد برضه)
  const dueChip = page.getByRole("button", { name: /المطلوب \d+/ });
  if ((await dueChip.count()) > 0) {
    await dueChip.first().click();
    await page.waitForTimeout(400);
  } else {
    const amt = page.locator('input[inputmode="decimal"]');
    await amt.fill("20");
  }
  await page.getByRole("button", { name: "تم الدفع" }).click();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => document.body.innerText);
  ok("رسالة النجاح ظاهرة بعد الدفع", after.includes("تم تسجيل الدفع") || after.includes("تم إضافة"));
  const hasA4 = await page.getByRole("button", { name: "طباعة الإيصال", exact: false }).first().isVisible().catch(() => false);
  const hasThermal = await page.getByRole("button", { name: "ثيرمال" }).first().isVisible().catch(() => false);
  ok("زرار طباعة الإيصال (A4) ظاهر بعد الدفع", hasA4);
  ok("زرار ثيرمال ظاهر بعد الدفع", hasThermal);

  // اطبع الإيصال الجديد
  await page.getByRole("button", { name: "طباعة الإيصال", exact: false }).first().click();
  await page.waitForTimeout(2500);
  const p2 = await page.evaluate(() => (window as unknown as { __prints: string[] }).__prints.at(-1) ?? "");
  ok("إيصال الدفعة الجديدة اتطبع", p2.includes("RC-"));
  ok("إيصال الدفعة فيه اسم الطالب", p2.includes("يوسف"));

  // ============ 3) STUDENT PROFILE LEDGER ============
  console.log("\n[3] ملف الطالب → كشف الحساب");
  await page.getByRole("button", { name: "رجوع للبحث" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "الطلاب" }).first().click();
  await page.waitForTimeout(2500);
  await page.locator('input[placeholder*="ابحث"]').fill("10004");
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: /يوسف/ }).first().click();
  await page.waitForTimeout(3000);
  const profile = await page.evaluate(() => document.body.innerText);
  ok("ملف الطالب فتح", profile.includes("كشف الحساب"));
  ok("الليدجر فيه اسم الموظف", profile.includes("سارة محمد"));
  const ledgerPrints = await page.locator('button[title="طباعة إيصال المعاملة"]').count();
  ok(`الليدجر فيه زراير طباعة (${ledgerPrints})`, ledgerPrints > 0);

  // ============ 4) API CHECKS ============
  console.log("\n[4] فحص API");
  const cookies = await ctx.cookies();
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const payRes = await fetch(`${BASE}/api/payments`, { headers: { cookie: cookieStr } });
  const payData = await payRes.json() as { payments: { byName?: string; type: string }[] };
  ok("GET /api/payments 200", payRes.status === 200);
  ok("payments فيها byName", typeof payData.payments?.[0]?.byName === "string");

  // refund receipt fallback (find a refund txn)
  const refundTxn = (await (await fetch(`${BASE}/api/payments`, { headers: { cookie: cookieStr } })).json() as { payments: { id: string; type: string }[] }).payments.find((p) => p.type === "REFUND");
  if (refundTxn) {
    const rc = await fetch(`${BASE}/api/receipts?txnId=${refundTxn.id}`, { headers: { cookie: cookieStr } });
    const rcData = await rc.json() as { receipt: { type: string; issuedByName: string } };
    ok("إيصال REFUND بيرجع 200 (fallback)", rc.status === 200);
    ok("نوعه REFUND", rcData.receipt?.type === "REFUND");
    ok("فيه اسم الموظف", typeof rcData.receipt?.issuedByName === "string");
  } else {
    console.log("  (مفيش REFUND حديثة — تخطي)");
  }

  // ============ 5) MANAGER: REFUND PRINT ============
  console.log("\n[5] مدير: طباعة استرداد من ملف الطالب");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click().catch(() => {});
  await page.waitForTimeout(2000);
  await login(page, "manager");
  const mgrText = await page.evaluate(() => document.body.innerText);
  ok("دخول مدير", mgrText.includes("بورتال المدير"));

  // صفحة الطلاب → طالبة عندها استرداد (هنا عمر فتحي 10018)
  await page.getByRole("button", { name: "الطلاب" }).first().click();
  await page.waitForTimeout(2500);
  await page.locator('input[placeholder*="ابحث"]').fill("10018");
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: /هنا عمر/ }).first().click();
  await page.waitForTimeout(3000);
  const hereProfile = await page.evaluate(() => document.body.innerText);
  ok("ملف هنا عمر فتح", hereProfile.includes("هنا عمر"));
  // دوّر على حركة استرداد في الليدجر
  const ledgerRows = await page.locator("li").filter({ hasText: "استرداد" }).count();
  ok(`حركات الاسترداد ظاهرة في الليدجر (${ledgerRows})`, ledgerRows > 0);

  // ============ ERRORS ============
  console.log("\n[6] أخطاء الصفحة");
  ok("صفر page errors", errors.filter((e) => !e.includes("favicon")).length === 0, errors.slice(0, 3).join(" | "));
  ok("صفر console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();

  // ============ 7) تنظيف: شيل دفعة الاختبار (وإيصالها وإشعارها) ============
  // من غير كده كل تشغيلة بتزوّد رصيد يوسف وتكسر التشغيلة الجاية (زر «تم الدفع» بيتحول لزرّي الباقي)
  console.log("\n[7] تنظيف دفعة الاختبار");
  try {
    const stu = await db.student.findFirst({ where: { code: "10004" }, select: { id: true } });
    if (stu) {
      const txn = await db.studentTransaction.findFirst({
        where: { studentId: stu.id, type: "PAYMENT" },
        orderBy: { createdAt: "desc" },
      });
      if (txn && Date.now() - txn.createdAt.getTime() < 10 * 60_000) {
        await db.receipt.deleteMany({ where: { txnId: txn.id } });
        await db.studentNotification.deleteMany({
          where: { studentId: stu.id, type: "PAYMENT", createdAt: { gte: txn.createdAt } },
        });
        await db.studentTransaction.deleteMany({ where: { id: txn.id } });
        ok("دفعة الاختبار اتنضفت (txn + receipt + notification)", true, txn.id.slice(-6));
      } else {
        ok("مفيش دفعة اختبار حديثة تتشال", true);
      }
    }
  } catch (e) {
    ok("التنظيف", false, String(e).slice(0, 80));
  }
  await db.$disconnect();

  console.log(`\n========== النتيجة: ${passed} ✓ / ${failed} ✗ ==========`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("CRASH:", e); process.exit(1); });
