/* OG image generator v2 — 1200×630 بهوية Alnokhba Managment الرسمية
   (كحلي #143159 + ذهبي #D5A134 + Cairo). اللوجو مدمج data-URI عشان
   file:// subresources بتتمنع من صفحات setContent. الناتج og.jpg مضغوط. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const logoB64 = fs.readFileSync("/home/z/my-project/public/logo.png").toString("base64");

const HTML = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: Cairo; src: url("file:///home/z/my-project/public/fonts/cairo-arabic.woff2") format("woff2"); font-weight: 400 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body { font-family: Cairo, sans-serif;
    background: linear-gradient(135deg, #143159 0%, #0f2647 60%, #0c1e3a 100%);
    position: relative; display: flex; align-items: center; }
  .glow1 { position: absolute; top: -160px; right: -120px; width: 480px; height: 480px;
    border-radius: 50%; background: #D5A134; opacity: .14; filter: blur(90px); }
  .glow2 { position: absolute; bottom: -200px; left: -100px; width: 560px; height: 560px;
    border-radius: 50%; background: #2f6fb3; opacity: .22; filter: blur(100px); }
  .wrap { position: relative; z-index: 2; padding: 0 72px; display: flex; align-items: center; gap: 52px; width: 1200px; }
  .mark { flex-shrink: 0; width: 180px; height: 180px; border-radius: 42px; background: #fff;
    border: 3px solid rgba(213,161,52,.8); display: flex; align-items: center; justify-content: center;
    box-shadow: 0 24px 60px rgba(0,0,0,.35); }
  .mark img { width: 82%; height: 82%; object-fit: contain; }
  .txt { flex: 1; min-width: 0; }
  .name { color: #fff; font-size: 74px; font-weight: 900; line-height: 1.12; letter-spacing: -.5px; direction: ltr; text-align: right; }
  .name span { color: #D5A134; }
  .sub { color: rgba(255,255,255,.92); font-size: 32px; font-weight: 700; margin-top: 14px; line-height: 1.55; }
  .chips { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
  .chip { color: #fff; font-size: 21px; font-weight: 800; padding: 8px 20px; border-radius: 999px;
    background: rgba(255,255,255,.10); border: 1.5px solid rgba(213,161,52,.55); }
  .url { position: absolute; bottom: 32px; left: 0; right: 0; text-align: center; direction: ltr;
    color: rgba(255,255,255,.55); font-size: 20px; font-weight: 700; letter-spacing: 1px; }
</style>
</head>
<body>
  <div class="glow1"></div><div class="glow2"></div>
  <div class="wrap">
    <div class="mark"><img src="data:image/png;base64,${logoB64}" alt=""></div>
    <div class="txt">
      <div class="name">Alnokhba <span>Managment</span></div>
      <div class="sub">منصة إدارة السنترات التعليمية — حضور بالـ QR وحسابات بالقروش</div>
      <div class="chips">
        <div class="chip">حضور بالـ QR</div>
        <div class="chip">دفعات واشتراكات</div>
        <div class="chip">بورتال طالب ومدرس</div>
        <div class="chip">وضع طوارئ أوفلاين</div>
      </div>
    </div>
  </div>
  <div class="url">alnokhba-centers.vercel.app</div>
</body>
</html>`;

(async () => {
  const tmp = "/home/z/my-project/scripts/_og_card.html";
  fs.writeFileSync(tmp, HTML);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto("file://" + tmp, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/home/z/my-project/public/og.jpg", type: "jpeg", quality: 85 });
  await browser.close();
  fs.unlinkSync(tmp);
  const kb = (fs.statSync("/home/z/my-project/public/og.jpg").size / 1024).toFixed(0);
  console.log(`og.jpg written (1200x630, ${kb}KB)`);
})();
