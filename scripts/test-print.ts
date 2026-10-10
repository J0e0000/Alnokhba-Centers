/* اختبار الطباعة بالمحاكاة الحقيقية لوضع print media
   يختبر: تقرير + كارت طالب + Ctrl+P العام */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  // ---- login ----
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /مدير — مركز النخبة/ }).click();
  await page.waitForTimeout(2000);

  // ---- 1) تقرير: زرار الطباعة ----
  await page.getByRole("button", { name: "التقارير" }).click();
  await page.waitForTimeout(2500); // التقرير يحمّل
  await page.evaluate(() => { (window as any).__printCalled = 0; window.print = () => { (window as any).__printCalled++; }; });
  await page.getByRole("button", { name: /طباعة \/ PDF/ }).click();
  await page.waitForTimeout(600); // الاستنى يرسم قبل فتح الحوار
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/print-1-report.png`, fullPage: true });

  const reportCheck = await page.evaluate(() => {
    const root = document.getElementById("nk-print-root");
    const header = document.querySelector("header.nk-glass-bar") as HTMLElement | null;
    const aside = document.querySelector("aside") as HTMLElement | null;
    const nav = document.querySelector("nav") as HTMLElement | null;
    const body = document.body;
    const kids = [...body.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.id || c.tagName);
    return {
      printCalled: (window as any).__printCalled,
      rootVisible: root ? getComputedStyle(root).display : null,
      headerHidden: !header || getComputedStyle(header).display === "none",
      asideHidden: !aside || getComputedStyle(aside).display === "none",
      navHidden: !nav || getComputedStyle(nav).display === "none",
      visibleBodyKids: kids,
      title: document.title,
      tableHeaderGroup: root ? getComputedStyle(root.querySelector(".nk-pr-table thead")!).display : null,
      cardCount: root?.querySelectorAll(".nk-pr-card, .nk-pr-stat").length ?? 0,
      colorAdjust: root ? getComputedStyle(root).webkitPrintColorAdjust || getComputedStyle(root).printColorAdjust : null,
    };
  });
  console.log("REPORT_PRINT:", JSON.stringify(reportCheck, null, 2));

  // رجّع الشاشة عادية
  await page.emulateMedia({ media: "screen" });
  await page.waitForTimeout(1800); // خلّي التنظيف يخلص

  // ---- 2) كارت الطالب ----
  await page.getByRole("button", { name: "الطلاب" }).click();
  await page.waitForTimeout(1500);
  // افتح أول كارت طالب (grid of buttons)
  await page.locator("main .grid button").first().click();
  await page.waitForTimeout(1500);
  // زرار "الكارت" في صفحة الطالب
  await page.getByRole("button", { name: /الكارت/ }).first().click();
  await page.waitForTimeout(1500); // الكروت بتحمّل QR
  await page.evaluate(() => { (window as any).__printCalled = 0; window.print = () => { (window as any).__printCalled++; }; });
  // زرار الطباعة جوه الديالوج
  await page.getByRole("button", { name: /طباعة/ }).click();
  await page.waitForTimeout(600);
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/print-2-card.png`, fullPage: true });

  const cardCheck = await page.evaluate(() => {
    const root = document.getElementById("nk-print-root");
    const cards = root?.querySelectorAll(".nk-print-card") ?? [];
    const first = cards[0] as HTMLElement | undefined;
    const qr = root?.querySelectorAll(".nk-print-card img").length ?? 0;
    return {
      printCalled: (window as any).__printCalled,
      cardCount: cards.length,
      firstCardSize: first ? { w: getComputedStyle(first).width, h: getComputedStyle(first).height } : null,
      qrImages: qr,
      gridCols: root ? getComputedStyle(root.querySelector(".nk-print-cards")!).gridTemplateColumns : null,
      headerHidden: (() => { const h = document.querySelector("header.nk-glass-bar") as HTMLElement | null; return !h || getComputedStyle(h).display === "none"; })(),
      title: document.title,
    };
  });
  console.log("CARD_PRINT:", JSON.stringify(cardCheck, null, 2));

  // ---- 3) Ctrl+P العام (من غير print root) ----
  await page.emulateMedia({ media: "screen" });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.print = () => {}; });
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  const ctrlPCheck = await page.evaluate(() => {
    const header = document.querySelector("header.nk-glass-bar") as HTMLElement | null;
    const aside = document.querySelector("aside") as HTMLElement | null;
    return {
      rootExists: !!document.getElementById("nk-print-root"),
      headerHidden: !header || getComputedStyle(header).display === "none",
      asideHidden: !aside || getComputedStyle(aside).display === "none",
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log("CTRL_P:", JSON.stringify(ctrlPCheck, null, 2));
  await page.screenshot({ path: `${OUT}/print-3-ctrlp.png`, fullPage: true });

  console.log("PAGE_ERRORS:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
