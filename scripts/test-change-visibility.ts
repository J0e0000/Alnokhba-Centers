/**
 * فحص الرؤية الفعلية (مش بس الوجود في DOM) لأزرار الباقي.
 * viewport-only screenshot للكارت نفسه + فحص isVisible + boundingBox.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
}

async function main() {
  const mres = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "nokhba123" }),
  });
  const mcookie = (mres.headers.get("set-cookie") ?? "").split(";")[0];
  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 800));
  await fetch(`${BASE}/api/demo`, { method: "POST", headers: { Cookie: mcookie } });
  const demoInfo = await (await fetch(`${BASE}/api/demo`, { headers: { Cookie: mcookie } })).json() as {
    students?: { code: string; name: string; balance: number }[];
  };
  const students = demoInfo.students ?? [];
  const debtor = students.find((s) => s.balance < 0) ?? students[0];
  console.log(`debtor: ${debtor?.name} code=${debtor?.code} balance=${debtor?.balance}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE}/`);
  await page.locator("#username").fill("manager");
  await page.locator('input[type="password"]').fill("nokhba123");
  await page.getByRole("button", { name: /دخول|تسجيل الدخول/ }).first().click();
  await page.waitForTimeout(3000);

  await page.getByRole("button", { name: "الحضور" }).first().click();
  await page.waitForTimeout(2500);

  const demoChip = page.locator("button", { hasText: /تجريبي/ }).first();
  if ((await demoChip.count()) > 0) {
    await demoChip.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const input = page.locator('input[placeholder*="اكتب الكود"]').first();
  await input.fill(String(debtor?.code ?? "99001"));
  await page.waitForTimeout(3000);

  const amountInput = page.locator('input[inputmode="decimal"]').first();
  ok("amount input VISIBLE", await amountInput.isVisible().catch(() => false));

  await amountInput.fill("500");
  await page.waitForTimeout(800);

  // فحص الرؤية الحقيقية
  const walletBtn = page.getByRole("button", { name: /أضف الباقي للمحفظة/ }).first();
  const returnBtn = page.getByRole("button", { name: /رجّع الباقي/ }).first();
  ok("wallet button VISIBLE", await walletBtn.isVisible().catch(() => false));
  ok("return button VISIBLE", await returnBtn.isVisible().catch(() => false));

  if (await walletBtn.isVisible().catch(() => false)) {
    const box = await walletBtn.boundingBox();
    console.log("wallet button box:", JSON.stringify(box));
    // scroll into view & screenshot the card only
    await walletBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
  }

  // viewport-only screenshot (متعملش fullPage — عشان نشوف اللي الموظف بيشوفه)
  await page.screenshot({ path: "/home/z/my-project/download/change-test-viewport.png" });

  // كمان: نقرّب على الكارت — locator screenshot للنتيجة
  const card = page.locator(".rounded-3xl").filter({ hasText: /دفع كام/ }).first();
  if ((await card.count()) > 0) {
    await card.screenshot({ path: "/home/z/my-project/download/change-test-card.png" }).catch(() => {});
    ok("card-only screenshot taken", true);
  } else {
    ok("card-only screenshot taken", false, "card locator not found");
  }

  await browser.close();
  console.log(`\n=== ${pass} passed / ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
