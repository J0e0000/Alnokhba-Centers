#!/usr/bin/env node
/* Screenshot key pages to verify new brand logos */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = "http://localhost:3000";

  const shots = [
    ["/", "v-landing"],
    ["/login", "v-login"],
    ["/staff-screen", "v-staff"],
  ];
  for (const [path, name] of shots) {
    try {
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `/home/z/my-project/scripts/${name}.png` });
      console.log("shot", name);
    } catch (e) {
      console.log("FAIL", name, e.message.slice(0, 120));
    }
  }
  // dark-mode main app shell needs auth — skip; verify favicon separately
  await browser.close();
})();
