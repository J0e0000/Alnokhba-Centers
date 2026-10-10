/* لقطة: البوب-أب العائم في البورتال أثناء وصول إشعار */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();

  // 1) الطالب بيدخل البورتال الأول (عشان الإشعار ييجي بعد التحميل → البانر يظهر)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await p.locator("#pcode").fill("10002");
  await p.locator("#pphone").fill("01055552222");
  await p.getByRole("button", { name: "دخول" }).click();
  await p.getByText("أهلاً يا محمد").waitFor({ state: "visible", timeout: 10000 });
  // استنى الفحص الأولي (priming) يخلص — بعده أي إشعار جديد = بانر
  await p.waitForTimeout(1500);

  // 2) المدير ينشر إعلان دلوقتي
  const mgrCtx = await browser.newContext();
  const mgrReq = mgrCtx.request;
  await mgrReq.post(`${BASE}/api/auth`, { data: { username: "manager", password: "nokhba123" } });
  await mgrReq.post(`${BASE}/api/announcements`, {
    data: {
      title: "اختبار اللقطة: حصة الفيزياء بدأت",
      body: "القاعة 3 — مستر خالد إبراهيم. النظام هيتتبع تلقائيًا.",
      audienceType: "ALL",
    },
  });
  await mgrCtx.close();

  // 3) رجوع للتبويب → فحص فوري → البانر ينزل
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.locator(".nk-toast-banner").first().waitFor({ state: "visible", timeout: 8000 });
  await p.waitForTimeout(700); // خلّص الأنيميشن (نزول من فوق) قبل اللقطة
  await p.screenshot({ path: `${OUT}/shot-portal-popup-banner.png`, fullPage: false });
  console.log("banner visible: true");

  // 4) التنضيف
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.announcement.deleteMany({ where: { title: { contains: "اختبار اللقطة" } } });
  await db.studentNotification.deleteMany({ where: { title: { contains: "اختبار اللقطة" } } });
  await db.$disconnect();
  console.log("cleaned");

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
