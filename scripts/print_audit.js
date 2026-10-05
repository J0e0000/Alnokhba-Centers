#!/usr/bin/env node
/* Audit print views: dark-mode print emulation screenshots + real PDFs */
const { chromium } = require("playwright");

const MODE = process.argv[2] || "dark";   // dark | light
const BRAND = process.argv[3] || "default"; // default | light
const TAG = `${MODE}-${BRAND}`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto("http://localhost:3000/print-lab", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);

  // set toggles: click Dark button if needed (default ON), Light brand if needed
  if (MODE === "light") {
    await page.getByRole("button", { name: /Dark:/ }).click();
  }
  if (BRAND === "light") {
    await page.getByRole("button", { name: /Brand:/ }).click();
  }
  await page.waitForTimeout(500);

  // 1) print-media emulation screenshot (what paper sees)
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/home/z/my-project/scripts/pl-${TAG}-print.png`, fullPage: true });

  // 2) real PDF (Save-as-PDF equivalent)
  await page.pdf({
    path: `/home/z/my-project/scripts/pl-${TAG}.pdf`,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });

  await page.emulateMedia({ media: "screen" });
  await browser.close();
  console.log("done", TAG);
})();
