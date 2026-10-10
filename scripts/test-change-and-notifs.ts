/**
 * اختبار شامل لمطالب المستخدم:
 * (1) الباقي: أزرار «أضف الباقي للمحفظة»/«رجّع الباقي» ظاهرة جوّه الشاشة من غير سكرول (sticky)
 * (2) المطلوب مش بيتحسب مرتين لما الطالب يكون حضر خلاص (bug الباقي الغلط)
 * (3) الدفعة بتبعت إشعار للطالب في البورتال + Push best-effort
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
}

async function main() {
  // ============ manager session ============
  const mres = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "nokhba123" }),
  });
  const mcookie = (mres.headers.get("set-cookie") ?? "").split(";")[0];
  ok("manager login", mcookie.length > 0);

  // ============ reset + create demo ============
  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 900));
  await fetch(`${BASE}/api/demo`, { method: "POST", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 1200));
  const demoInfo = await (await fetch(`${BASE}/api/demo`, { headers: { Cookie: mcookie } })).json() as {
    students?: { code: string; name: string; balance: number }[];
  };
  const students = demoInfo.students ?? [];
  ok("demo students ready", students.length >= 4, `${students.length} طالب`);
  // /api/demo مبيعّش id → نجيبه من lookup كود-كود
  const idByCode = new Map<string, string>();
  for (const s of students) {
    const one = await (await fetch(`${BASE}/api/lookup?q=${s.code}`, { headers: { Cookie: mcookie } })).json() as {
      students?: { id: string; code: string }[];
    };
    if (one.students?.[0]) idByCode.set(s.code, one.students[0].id);
  }
  const withIds = students.map((s) => ({ ...s, id: idByCode.get(s.code) ?? "" }));
  const debtor = withIds.find((s) => s.balance < 0) ?? withIds[0];

  // حصص الديمو
  const sessRes = await (await fetch(`${BASE}/api/sessions`, { headers: { Cookie: mcookie } })).json() as {
    sessions?: { id: string; subject: string; groupName: string; status: string; date: string }[];
  };
  const todaySessions = sessRes.sessions ?? [];
  console.log(`sessions today: ${todaySessions.length}`);

  // ============================ (1) الباقي ظاهرة جوّه الشاشة ============================
  console.log("\n— (1) الباقي: أزرار الباقي ظاهرة من غير سكرول —");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } }); // شاشة لابتاب عادية

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
  const wizardVisible = await amountInput.isVisible().catch(() => false);
  ok("wizard opened after scan", wizardVisible);

  if (wizardVisible) {
    await amountInput.fill("500");
    await page.waitForTimeout(800);

    const walletBtn = page.getByRole("button", { name: /أضف الباقي للمحفظة/ }).first();
    const returnBtn = page.getByRole("button", { name: /رجّع الباقي/ }).first();
    ok("wallet button exists", (await walletBtn.count()) > 0);
    ok("return-change button exists", (await returnBtn.count()) > 0);

    // ★ الفحص الجديد: الزرار لازم يكون جوّه الشاشة (viewport) — ده كان الباج
    const vp = page.viewportSize()!;
    if (await walletBtn.isVisible().catch(() => false)) {
      const box = await walletBtn.boundingBox();
      const inViewport = !!box && box.y >= 0 && box.y + box.height <= vp.height;
      ok("★ wallet button INSIDE viewport (no scroll needed)", inViewport,
        box ? `y=${Math.round(box.y)} h=${Math.round(box.height)} vp=${vp.height}` : "no box");
    } else {
      ok("★ wallet button INSIDE viewport (no scroll needed)", false, "not visible");
    }

    // بعد الضغط: مفيش سكرول ضروري — الزرار قابل للضغط
    await walletBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: "/home/z/my-project/download/change-sticky-fixed.png" });
  }

  // ============================ (2) المطلوب مش بيتكرر بعد الحضور ============================
  console.log("\n— (2) المطلوب بعد حضور مسجل: الدين بس (بدون تكرار سعر الحصة) —");
  if (todaySessions.length > 0 && withIds.length > 1) {
    const sess = todaySessions[0];
    // طالب تاني (غير المديون) → علشان نقيس المطلوب بعد الشحن بدقة
    const s2 = withIds.find((s) => s.id !== debtor.id && s.id) ?? withIds[1];
    // اقرأ رصيده الحالي
    const before = await (await fetch(`${BASE}/api/students/${s2.id}`, { headers: { Cookie: mcookie } })).json() as { balance: number };
    // سجّل حضوره في الحصة (الشحن بيحصل هنا)
    const mark = await (await fetch(`${BASE}/api/attendance/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: mcookie },
      body: JSON.stringify({ studentId: s2.id, sessionId: sess.id, status: "PRESENT" }),
    })).json() as { balance: number; amountDue: number; charged?: number };
    const charged = before.balance - mark.balance; // الشحن بالسالب
    // امسحه تاني → المطلوب لازم يكون الدين بالظبط (مش السعر + الدين)
    const scan2 = await (await fetch(`${BASE}/api/attendance/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: mcookie },
      body: JSON.stringify({ query: s2.code, sessionId: sess.id }),
    })).json() as { amountDue: number | null; balance: number; alreadyAttended: boolean };
    const expectedDue = Math.max(-mark.balance, 0);
    ok("scan after attendance: alreadyAttended=true", scan2.alreadyAttended === true);
    ok("★ amountDue = debt only (was double-counting price)",
      scan2.amountDue === expectedDue,
      `charged=${-charged / 100}ج · debt=${expectedDue / 100}ج · got=${(scan2.amountDue ?? 0) / 100}ج`);
  } else {
    ok("(2) skipped — no demo sessions today", true);
  }

  // ============================ (3) إشعار الدفعة في البورتال ============================
  console.log("\n— (3) الدفعة → إشعار في بورتال الطالب + Push —");
  // سجّل دفعة للطالب المديون (عبر API زي ما الويزارد بيعمل)
  const payRes = await (await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mcookie },
    body: JSON.stringify({ studentId: debtor.id, amount: 10, method: "CASH", type: "PAYMENT" }),
  })).json() as { txn?: { id: string }; message?: string; balance?: number };
  ok("payment recorded", !!payRes.txn?.id, payRes.message ?? "");

  // سجّل دخول البورتال كالطالب (كود + موبايل ولي الأمر بتاع الديمو — على ترتيب الديمو)
  const lastDigit = 6 - (99006 - parseInt(debtor.code, 10)); // نور(99006)=6 · على(99001)=1
  const phone = `0100000000${lastDigit}`;
  const pRes = await fetch(`${BASE}/api/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", code: debtor.code, phone }),
  });
  const pcookie = (pRes.headers.get("set-cookie") ?? "").split(";")[0];
  ok("student portal login", pcookie.length > 0, `code=${debtor.code} phone=${phone}`);

  if (pcookie) {
    const notif = await (await fetch(`${BASE}/api/portal/notifications`, { headers: { Cookie: pcookie } })).json() as {
      notifications?: { id: string; type: string; typeMeta: { icon: string; label: string }; title: string; body: string }[];
      unread?: number;
    };
    const payNotif = (notif.notifications ?? []).find((n) => n.type === "PAYMENT");
    ok("★ payment notification exists in portal", !!payNotif);
    if (payNotif) {
      ok("notification has PAYMENT typeMeta", payNotif.typeMeta.label === "دفعة", `icon=${payNotif.typeMeta.icon}`);
      ok("notification body mentions the amount", payNotif.body.includes("10"), payNotif.body);
      console.log(`   notification: «${payNotif.title}» — ${payNotif.body}`);
    }
    ok("unread count > 0", (notif.unread ?? 0) > 0);

    // الواجهة: تاب الرسايل بيعرض الإشعار
    await page.goto(`${BASE}/portal`);
    await page.waitForTimeout(2500);
    // سجّل دخول الطالب من واجهة البورتال (كوكي البورتال منفصل عن كوكي الموظفين)
    const codeField = page.locator('input[placeholder="00000"]').first();
    if (await codeField.isVisible().catch(() => false)) {
      await codeField.fill(debtor.code);
      await page.locator('input[placeholder="01xxxxxxxxx"]').first().fill(phone);
      await page.getByRole("button", { name: /دخول/ }).first().click();
      await page.waitForTimeout(2500);
    }
    // افتح تاب الرسايل
    const msgTab = page.getByRole("button", { name: /الرسايل|الرسائل/ }).first();
    if ((await msgTab.count()) > 0) {
      await msgTab.click();
      await page.waitForTimeout(1500);
    }
    const notifInUI = await page.getByText(/دفعة جديدة/).count();
    ok("★ payment notification visible in portal UI (messages tab)", notifInUI > 0);
    await page.screenshot({ path: "/home/z/my-project/download/portal-payment-notification.png" });
  }

  await browser.close();

  // ============================ (4) Push pipeline (best-effort) ============================
  console.log("\n— (4) Push: الاشتراك بيتخزن والدفع مش بيكسر —");
  // مفتاح VAPID اتولّد للسنتر (sendPushToStudents بيناديه)
  const vapidCheck = await (await fetch(`${BASE}/api/portal/push`, { headers: { Cookie: pcookie } })).json() as { publicKey?: string | null };
  ok("VAPID public key generated for center", typeof vapidCheck.publicKey === "string" && vapidCheck.publicKey.length > 60,
    vapidCheck.publicKey ? `${vapidCheck.publicKey.slice(0, 20)}...` : "null");

  // اشتراك وهمي → دفعة تانية → الدفع لازم ينجح والاشتراك الفاشل مش يكسر حاجة
  const fakeSub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/dAFAKEENDPOINT123",
    keys: { p256dh: "BFakeKey", auth: "FakeAuth" },
  };
  const subRes = await fetch(`${BASE}/api/portal/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: pcookie },
    body: JSON.stringify({ subscription: fakeSub }),
  });
  ok("fake push subscription stored", subRes.ok);

  const pay2 = await (await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mcookie },
    body: JSON.stringify({ studentId: debtor.id, amount: 5, method: "CASH", type: "PAYMENT" }),
  })).json() as { txn?: { id: string } };
  ok("★ payment succeeds even when push endpoint is dead", !!pay2.txn?.id);
  await new Promise((r) => setTimeout(r, 1500)); // سيب فرصة للـ push best-effort

  // ============================ cleanup ============================
  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 800));
  const after = await (await fetch(`${BASE}/api/dashboard`, { headers: { Cookie: mcookie } })).json().catch(() => null);
  void after;
  console.log("\n— تم مسح بيانات الاختبار (ديمو) —");

  console.log(`\n=== ${pass} passed / ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
