import { chromium } from "playwright";
import fs from "fs";

const AUDIT_SRC = fs.readFileSync("/home/z/my-project/scripts/audit-fn.js", "utf-8");

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
  const res = await p.evaluate(AUDIT_SRC);
  console.log(JSON.stringify(res.issues, null, 1));
  await b.close();
}
main();
