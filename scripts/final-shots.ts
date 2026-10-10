import { chromium } from "playwright";

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  // visible viewport only (no fullPage) for accurate VLM reading
  await p.screenshot({ path: "/home/z/my-project/download/contrast-shots/vlm-landing-hero.png" });
  // steps section (the fixed step numbers)
  await p.locator("#how").scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  await p.screenshot({ path: "/home/z/my-project/download/contrast-shots/vlm-landing-steps.png" });
  await b.close();
  console.log("ok");
}
main();
