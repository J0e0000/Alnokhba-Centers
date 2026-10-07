#!/usr/bin/env node
/* Task F visual verification — surfaces changed in the redesign pass */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = "http://localhost:3000";

  const shots = [
    ["/", "f2-landing"],
    ["/login", "f2-login"],
    ["/staff-screen", "f2-staff-screen"],
    ["/a/totally-invalid-token", "f2-a-invalid"],
    ["/s/totally-invalid-token", "f2-s-invalid"],
  ];
  for (const [path, name] of shots) {
    try {
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `/home/z/my-project/scripts/${name}.png` });
      console.log("shot", name);
    } catch (e) {
      console.log("FAIL", name, e.message.slice(0, 100));
    }
  }

  // mobile landing too
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto(base + "/", { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: "/home/z/my-project/scripts/f2-landing-mobile.png" });
    console.log("shot f2-landing-mobile");
  } catch (e) { console.log("FAIL mobile", e.message.slice(0, 100)); }

  await browser.close();
})();
