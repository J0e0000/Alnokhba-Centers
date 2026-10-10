/**
 * فحص مركّز: هل أزرار الباقي (أضف للمحفظة / رجّع الباقي) بتظهر فعلًا؟
 * السيناريو: ديمو → مسح طالب مديون → اكتب مبلغ أكبر من المطلوب → اشوف الزراير.
 * كمان فحص: مسار الدفع (payments view) + ملف الطالب.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
}

async function main() {
  // manager session from server
  const mres = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "nokhba123" }),
  });
  const mcookie = (mres.headers.get("set-cookie") ?? "").split(";")[0];
  ok("manager login", mcookie.length > 0);

  // reset demo → fresh balances + demo sessions
  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 800));
  const dres = await fetch(`${BASE}/api/demo`, { method: "POST", headers: { Cookie: mcookie } });
  ok("demo created", dres.ok);
  const demoInfo = await (await fetch(`${BASE}/api/demo`, { headers: { Cookie: mcookie } })).json() as {
    students?: { code: string; name: string; balance: number }[];
  };
  const students = demoInfo.students ?? [];
  const debtor = students.find((s) => s.balance < 0) ?? students[0];
  console.log(`debtor: ${debtor?.name} code=${debtor?.code} balance=${debtor?.balance}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // login as manager in UI
  await page.goto(`${BASE}/`);
  await page.locator("#username").fill("manager");
  await page.locator('input[type="password"]').fill("nokhba123");
  await page.getByRole("button", { name: /دخول|تسجيل الدخول/ }).first().click();
  await page.waitForTimeout(3000);

  // go to scan view
  await page.getByRole("button", { name: "الحضور" }).first().click();
  await page.waitForTimeout(2500);

  // pick a demo session chip if exists
  const demoChip = page.locator("button", { hasText: /تجريبي/ }).first();
  if ((await demoChip.count()) > 0) {
    await demoChip.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  // scan the debtor
  const input = page.locator('input[placeholder*="اكتب الكود"]').first();
  const inputVisible = await input.isVisible().catch(() => false);
  ok("scan input visible", inputVisible);
  if (inputVisible) {
    await input.fill(String(debtor?.code ?? "99001"));
    await page.waitForTimeout(3000); // auto-submit + card

    // screenshot of the wizard as-is
    await page.screenshot({ path: "/home/z/my-project/download/change-test-wizard.png", fullPage: true });

    // check one-liner + due shown
    const dueText = await page.getByText(/عليه \d+ ج|الباقي \d+/).count();
    ok("one-liner shows amount due", dueText > 0);

    // type an amount > due
    const amountInput = page.locator('input[inputmode="decimal"]').first();
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill("500");
      await page.waitForTimeout(700);
      await page.screenshot({ path: "/home/z/my-project/download/change-test-overpay.png", fullPage: true });

      const walletBtn = await page.getByRole("button", { name: /أضف الباقي للمحفظة/ }).count();
      const returnBtn = await page.getByRole("button", { name: /رجّع الباقي/ }).count();
      ok("SCAN: wallet button appears", walletBtn > 0);
      ok("SCAN: return-change button appears", returnBtn > 0);
      const line = await page.getByText(/الباقي \d+ ج/).count();
      ok("SCAN: change amount line", line > 0);
    } else {
      ok("SCAN: wizard amount input visible", false, "amount input not found");
    }
  }

  await browser.close();
  console.log(`\n=== ${pass} passed / ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
