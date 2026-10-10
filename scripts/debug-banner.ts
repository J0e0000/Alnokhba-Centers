/* تصحيح: مكان البانر بالظبط */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();

  const mgrCtx = await browser.newContext();
  const mgrReq = mgrCtx.request;
  await mgrReq.post(`${BASE}/api/auth`, { data: { username: "manager", password: "nokhba123" } });
  await mgrReq.post(`${BASE}/api/announcements`, {
    data: { title: "تصحيح: بانر الاختبار", body: "نص تجريبي.", audienceType: "ALL" },
  });
  await mgrCtx.close();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await p.locator("#pcode").fill("10002");
  await p.locator("#pphone").fill("01055552222");
  await p.getByRole("button", { name: "دخول" }).click();
  await p.waitForTimeout(3000);
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.getByText("تصحيح: بانر الاختبار").first().waitFor({ state: "visible", timeout: 8000 });

  // مكان كل عنصر بيقول "تصحيح: بانر الاختبار"؟
  const boxes = await p.getByText("تصحيح: بانر الاختبار").all();
  for (const el of boxes) {
    const bb = await el.boundingBox().catch(() => null);
    const cls = await el.getAttribute("class").catch(() => "");
    console.log("element:", JSON.stringify(bb), "class:", (cls ?? "").slice(0, 80));
  }
  const toast = p.locator(".nk-toast-banner");
  console.log("toast count:", await toast.count());
  if (await toast.count() > 0) {
    console.log("toast box:", JSON.stringify(await toast.first().boundingBox()));
  }
  await p.screenshot({ path: "/tmp/dbg-banner.png" });

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.announcement.deleteMany({ where: { title: { contains: "تصحيح" } } });
  await db.studentNotification.deleteMany({ where: { title: { contains: "تصحيح" } } });
  await db.$disconnect();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
