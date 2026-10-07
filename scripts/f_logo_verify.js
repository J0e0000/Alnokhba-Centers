#!/usr/bin/env node
/* Task F logo verification — screenshot landing/login/app + dump every img src actually rendered */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = "http://localhost:3000";

  const imgs = new Set();
  page.on("response", (res) => {
    const u = res.url();
    if (/\.(png|svg|jpg|jpeg|webp|ico)(\?|$)/i.test(u)) imgs.add(`${res.status()} ${u}`);
  });

  const shots = [
    ["/", "f-landing"],
    ["/login", "f-login"],
  ];
  for (const [path, name] of shots) {
    try {
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `/home/z/my-project/scripts/${name}.png` });
      console.log("shot", name);
    } catch (e) {
      console.log("FAIL", name, e.message.slice(0, 120));
    }
  }
  console.log("--- image responses ---");
  for (const i of [...imgs].sort()) console.log(i);

  // check sw.js version served
  const sw = await page.request.get(base + "/sw.js");
  const txt = await sw.text();
  console.log("--- sw.js cache name:", (txt.match(/nokhba-shell-v\d+/) || ["?"])[0]);
  await browser.close();
})();
