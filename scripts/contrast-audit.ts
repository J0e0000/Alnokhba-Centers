/**
 * فاحص التباين الشامل (Contrast Audit) — يقيس الألوان الفعلية المحسوبة في المتصفح
 * لكل نص ظاهر في كل شاشة (فاتح + داكن) ويحسب نسبة تباين WCAG.
 *
 * التشغيل: npx tsx scripts/contrast-audit.ts [--quick] [--json]
 *   --quick  شاشات أساسية فقط (للتكرار السريع بعد الإصلاح)
 *
 * المعيار: نص عادي ≥ 4.5:1 · نص كبير (≥24px أو ≥18.66px بولد) ≥ 3:1
 *          placeholder ≥ 4.5:1 · عناصر disabled ≥ 3:1 (WCAG معفاة بس بنرصدها)
 */
import { chromium, type Page } from "playwright";
import fs from "fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/contrast-shots";
const REPORT_JSON = "/home/z/my-project/download/contrast-report.json";

// ============================================================ in-page auditor
const AUDIT_SRC = `(() => {
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();

  function tryParse(color) {
    if (!color) return null;
    if (cache.has(color)) return cache.get(color);
    let out = null;
    if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
      out = [0, 0, 0, 0];
    } else {
      try {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = '#123456';
        const before = cx.fillStyle;
        cx.fillStyle = color;
        if (cx.fillStyle !== before || color.toLowerCase().replace('#', '') === '123456') {
          cx.fillRect(0, 0, 1, 1);
          const d = cx.getImageData(0, 0, 1, 1).data;
          out = [d[0], d[1], d[2], d[3] / 255];
        }
      } catch (e) { out = null; }
    }
    cache.set(color, out);
    return out;
  }

  function extractColorTokens(str) {
    const tokens = [];
    const re = /(#[0-9a-fA-F]{3,8})(?![0-9a-fA-F])|\\b(rgba?|hsla?|color-mix|oklch|oklab|color)\\(/g;
    let m;
    while ((m = re.exec(str))) {
      if (m[1]) { tokens.push(m[1]); continue; }
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < str.length; i++) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') { depth--; if (depth === 0) break; }
      }
      tokens.push(str.slice(m.index, i + 1));
    }
    return tokens;
  }

  function blend(top, bottom) {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [
      Math.round((top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / a),
      Math.round((top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / a),
      Math.round((top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / a),
      a,
    ];
  }

  function effectiveBackground(el) {
    let acc = null;
    let node = el;
    while (node && node instanceof Element) {
      const cs = getComputedStyle(node);
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && bi.indexOf('gradient') >= 0) {
        const toks = extractColorTokens(bi).map(tryParse).filter((t) => t && t[3] > 0);
        if (toks.length) {
          const cands = [];
          for (const t of toks) {
            if (t[3] >= 0.999) cands.push(t);
            else if (acc) cands.push(blend(t, acc));
          }
          if (cands.length) return cands;
        }
      }
      const c = tryParse(cs.backgroundColor);
      if (c && c[3] > 0) {
        acc = acc ? blend(c, acc) : c;
        if (acc[3] >= 0.995) return [acc];
      }
      node = node.parentElement;
    }
    const rootBg = tryParse(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1];
    if (!acc) return [rootBg[3] > 0 ? rootBg : [255, 255, 255, 1]];
    return [acc[3] >= 0.995 ? acc : blend(acc, rootBg[3] > 0 ? rootBg : [255, 255, 255, 1])];
  }

  function lum(rgb) {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function hex(c) {
    const p = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + p(c[0]) + p(c[1]) + p(c[2]) + (c[3] < 0.999 ? ' a' + Math.round(c[3] * 100) / 100 : '');
  }

  function hasHiddenAncestor(el) {
    let n = el;
    while (n && n instanceof Element) {
      const cs = getComputedStyle(n);
      if (cs.opacity === '0') return true;
      if (cs.visibility === 'hidden') return true;
      n = n.parentElement;
    }
    return false;
  }

  function pathOf(el) {
    let s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const c = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
      if (c) s += '.' + c;
    }
    return s;
  }

  const map = new Map();
  let checked = 0;

  function record(key, info) {
    if (!map.has(key)) map.set(key, { ...info, samples: [] });
    const e = map.get(key);
    if (e.samples.length < 5) e.samples.push(info.sample);
  }

  function auditTextEl(el, text, colorCss, kind) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    if (hasHiddenAncestor(el)) return;
    if ((el.className || '').toString().includes('sr-only')) return;
    const range = document.createRange();
    let rects;
    try {
      range.selectNodeContents(el.firstChild ? (el.childNodes.length === 1 ? el.firstChild : el) : el);
      rects = range.getClientRects();
    } catch (e) { return; }
    if (!rects.length || rects[0].width < 1 || rects[0].height < 1) return;

    const fg = tryParse(colorCss);
    if (!fg) return;
    const size = parseFloat(cs.fontSize) || 16;
    const weightNum = parseInt(cs.fontWeight, 10);
    const weight = isNaN(weightNum) ? (cs.fontWeight === 'bold' ? 700 : 400) : weightNum;
    const bold = weight >= 700;
    const large = kind === 'text' && (size >= 24 || (size >= 18.66 && bold));
    const disabled = kind === 'text' && !!(el.closest('[disabled], [aria-disabled="true"]') || cs.cursor === 'not-allowed');
    const bgs = effectiveBackground(el);

    let worst = null;
    for (const bg of bgs) {
      const effFg = fg[3] >= 0.995 ? fg : blend(fg, bg);
      const r = contrast(effFg, bg);
      if (!worst || r < worst.ratio) worst = { ratio: r, fg: effFg, bg };
    }
    if (!worst) return;
    checked++;
    const need = disabled ? 3.0 : (large ? 3.0 : 4.5);
    if (worst.ratio < need) {
      const key = [hex(fg), hex(worst.bg), large, disabled, kind].join('|');
      record(key, {
        ratio: Math.round(worst.ratio * 100) / 100,
        fg: hex(fg), bg: hex(worst.bg),
        large, disabled, kind,
        size: Math.round(size * 10) / 10, weight,
        sample: text.slice(0, 48) + ' ← ' + pathOf(el),
      });
    }
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent && n.textContent.trim().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement;
    if (!el) continue;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    const text = node.textContent.trim();
    if (!text) continue;
    auditTextEl(el, text, getComputedStyle(el).color, 'text');
  }

  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (hasHiddenAncestor(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const pcs = getComputedStyle(el, '::placeholder');
    auditTextEl(el, '[placeholder] ' + (el.getAttribute('placeholder') || ''), pcs.color, 'placeholder');
  });

  const issues = Array.from(map.values()).sort((a, b) => a.ratio - b.ratio);
  return { checked, issues };
})()`;

// ============================================================ helpers
type Theme = "light" | "dark";

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate((t) => localStorage.setItem("nk-theme", t), theme);
}

async function dismissTours(page: Page) {
  // جولة الطالب/المدرس بتاعقة الكليك — اقفلها بأي طريقة
  for (let i = 0; i < 3; i++) {
    const skip = page.locator('[aria-label="تخطي الجولة"], button:has-text("تخطي الجولة")').first();
    if (!(await skip.isVisible().catch(() => false))) break;
    await skip.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function scrollPass(page: Page) {
  await dismissTours(page);
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
}

async function auditPage(page: Page, name: string, theme: Theme): Promise<{ page: string; theme: string; checked: number; issues: any[] }> {
  await scrollPass(page);
  await page.waitForTimeout(400);
  const res = await page.evaluate(AUDIT_SRC);
  await page.screenshot({ path: `${OUT_DIR}/${name.replace(/[^\w\u0600-\u06FF-]+/g, "_")}${theme === "dark" ? "--dark" : ""}.png`, fullPage: true }).catch(() => {});
  return { page: name, theme, checked: res.checked, issues: res.issues };
}

async function clickVisibleByText(page: Page, label: string, exact = true) {
  await dismissTours(page);
  const cands = page.getByRole("button", { name: label, exact });
  const n = await cands.count();
  for (let i = 0; i < n; i++) {
    const c = cands.nth(i);
    if (await c.isVisible().catch(() => false)) {
      await c.click();
      return true;
    }
  }
  // fallback: any element
  const cands2 = page.getByText(label, { exact }).locator("button, a, [role=button]");
  const n2 = await cands2.count();
  for (let i = 0; i < n2; i++) {
    const c = cands2.nth(i);
    if (await c.isVisible().catch(() => false)) {
      await c.click();
      return true;
    }
  }
  return false;
}

async function staffLogin(page: Page, user: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.fill("#username", user);
  await page.fill("#password", "nokhba123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/app**", { timeout: 30000 });
  await page.waitForTimeout(1500);
}

const MANAGER_TABS = ["الرئيسية", "الحضور", "الدفع", "الطلاب", "الموافقات", "المجموعات", "الجداول", "الكتب", "الرسائل", "الحسابات", "التقارير", "الطوارئ", "الإعدادات"];
const ADMIN_TABS = ["السناتر", "طلبات الانضمام", "الاشتراكات", "الطلاب", "الفوترة", "الفرق", "النسخ الاحتياطية", "النظام", "المراقبة"];
const RECEPTION_TABS = ["الرئيسية", "الحضور", "الدفع", "الطلاب"];

// ============================================================ main
async function main() {
  const quick = process.argv.includes("--quick");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results: any[] = [];

  const runScreen = async (name: string, page: Page, theme: Theme) => {
    try {
      const r = await auditPage(page, name, theme);
      results.push(r);
      const flag = r.issues.filter((i) => !i.disabled).length;
      const dis = r.issues.filter((i) => i.disabled).length;
      console.log(`  ${flag === 0 ? "✓" : "✗"} ${name} [${theme}] — ${r.checked} نص · ${flag} مشكلة${dis ? ` + ${dis} disabled` : ""}`);
    } catch (e: any) {
      console.error(`  ! ${name} [${theme}] فشل: ${e.message.slice(0, 100)}`);
    }
  };

  // ============ 1) الهبوط + الدخول (فاتح — light-locked)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await runScreen("landing", page, "light");

    // FAQ: افتح مجموعة + سؤال
    const faqGroup = page.locator("button, [role=button]").filter({ hasText: /كيف|إزاي|بتعمل|الطوارئ|الحضور|الدفع|الحساب/ }).first();
    if (await faqGroup.isVisible().catch(() => false)) {
      await faqGroup.click().catch(() => {});
      await page.waitForTimeout(500);
      const q = page.locator("button").filter({ hasText: /؟$/ }).first();
      if (await q.isVisible().catch(() => false)) { await q.click().catch(() => {}); await page.waitForTimeout(700); }
      await runScreen("landing-faq-open", page, "light");
    }
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await runScreen("login", page, "light");
    // signup dialog
    const suBtn = page.getByRole("button", { name: /حساب جديد|سجّل|انضم|إنشاء حساب/ });
    if (await suBtn.first().isVisible().catch(() => false)) {
      await suBtn.first().click();
      await page.waitForTimeout(700);
      await runScreen("login-signup-dialog", page, "light");
    }
    await ctx.close();
  }

  // ============ 2) بورتال الطالب (موبايل — فاتح)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await runScreen("student-login", page, "light");

    await page.fill("#pcode", "10002");
    await page.fill("#pphone", "01055552222");
    await page.getByRole("button", { name: "دخول", exact: true }).first().click();
    await page.waitForTimeout(3000);
    await runScreen("student-home", page, "light");

    for (const tab of ["جدولي", "الرسائل"]) {
      if (await clickVisibleByText(page, tab)) {
        await page.waitForTimeout(1300);
        await runScreen(`student-${tab}`, page, "light");
      }
    }
    await ctx.close();
  }

  // ============ 3) بورتال المدرس (موبايل — فاتح)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/teacher`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await runScreen("teacher-login", page, "light");

    await page.fill("#tphone", "01011112222");
    await page.fill("#tcode", "4996");
    await page.getByRole("button", { name: /دخول|تسجيل/ }).first().click();
    await page.waitForTimeout(3000);
    await runScreen("teacher-home", page, "light");
    await ctx.close();
  }

  // ============ 4) بورتال الأدمن (فاتح — light-locked)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await staffLogin(page, "admin");
    for (const tab of ADMIN_TABS) {
      if (await clickVisibleByText(page, tab)) {
        await page.waitForTimeout(1600);
        await runScreen(`admin-${tab}`, page, "light");
      } else {
        console.log(`  ! admin tab مش موجود: ${tab}`);
      }
    }
    await ctx.close();
  }

  // ============ 5) بورتال السنتر — مدير (فاتح + داكن)
  const managerScreens: [string, () => Promise<void>][] = [];
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await staffLogin(page, "manager");

    for (const theme of (quick ? ["dark"] : ["light", "dark"]) as Theme[]) {
      await setTheme(page, theme);
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);

      for (const tab of quick ? ["الرئيسية", "الطلاب", "الحضور"] : MANAGER_TABS) {
        if (await clickVisibleByText(page, tab)) {
          await page.waitForTimeout(1500);
          await runScreen(`manager-${tab}`, page, theme);
        } else {
          console.log(`  ! manager tab مش موجود: ${tab} [${theme}]`);
        }
      }

      // مساحة عمل الحصة — افتح أول حصة من الجداول
      if (await clickVisibleByText(page, "الجداول")) {
        await page.waitForTimeout(1500);
        const sessionBtn = page.locator("button").filter({ hasText: /(حصة|التفاصيل|استكمال|مجموعة)/ }).first();
        if (await sessionBtn.isVisible().catch(() => false)) {
          await sessionBtn.click();
          await page.waitForTimeout(2200);
          await runScreen("manager-session-workspace", page, theme);
          // رجوع
          await clickVisibleByText(page, /رجوع|رجوع للقائمة|إلغاء/).catch(() => {});
          const back = page.getByRole("button", { name: /رجوع|عودة|القائمة/ }).first();
          if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(1000); }
        }
      }

      // ملف طالب
      if (await clickVisibleByText(page, "الطلاب")) {
        await page.waitForTimeout(1500);
        const st = page.locator("button, a, tr").filter({ hasText: /محمد|أحمد|طالب/ }).first();
        if (await st.isVisible().catch(() => false)) {
          await st.click();
          await page.waitForTimeout(2000);
          await runScreen("manager-student-profile", page, theme);
        }
      }

      // ديالوج إضافة طالب
      if (await clickVisibleByText(page, "الطلاب")) {
        await page.waitForTimeout(1400);
        if (await clickVisibleByText(page, "إضافة طالب", false)) {
          await page.waitForTimeout(900);
          await runScreen("manager-add-student-dialog", page, theme);
          await page.keyboard.press("Escape");
        }
      }
    }
    await ctx.close();
  }

  // ============ 6) استقبال — عينة (فاتح + داكن)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await staffLogin(page, "reception");
    for (const theme of (quick ? ["dark"] : ["light", "dark"]) as Theme[]) {
      await setTheme(page, theme);
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      for (const tab of RECEPTION_TABS) {
        if (await clickVisibleByText(page, tab)) {
          await page.waitForTimeout(1500);
          await runScreen(`reception-${tab}`, page, theme);
        }
      }
    }
    await ctx.close();
  }

  // ============ 7) مدير موبايل — عينة (فاتح + داكن)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await staffLogin(page, "manager");
    for (const theme of (quick ? ["light"] : ["light", "dark"]) as Theme[]) {
      await setTheme(page, theme);
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      await runScreen("manager-mobile-home", page, theme);
      for (const tab of ["الطلاب", "الحضور"]) {
        if (await clickVisibleByText(page, tab)) {
          await page.waitForTimeout(1500);
          await runScreen(`manager-mobile-${tab}`, page, theme);
        }
      }
    }
    await ctx.close();
  }

  // ============ 8) أكاديميا النخبة — مدرس + مدير (موبايل — التطبيق mobile-first) فاتح + داكن
  {
    const ACA_TABS_TEACHER = ["الرئيسية", "المجموعات", "الطلاب", "الامتحانات"];
    const ACA_TABS_MANAGER = ["الرئيسية", "المجموعات", "الطلاب", "الامتحانات", "الطلبات", "التقارير"];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    const acaLogin = async (user: string) => {
      await ctx.clearCookies(); // السيشن القديم بيرديّر /login على /academia — نمسحه
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1200);
      await page.fill("#username", user);
      await page.fill("#password", "academia123");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/academia**", { timeout: 30000 });
      await page.waitForTimeout(1800);
    };

    for (const [user, tabs] of [["aca-teacher1", ACA_TABS_TEACHER], ["aca-manager", ACA_TABS_MANAGER]] as const) {
      for (const theme of ["light", "dark"] as Theme[]) {
        try {
          await acaLogin(user); // بيروح /academia (فاتح افتراضيًا)
          await setTheme(page, theme); // محتاج أصل على دومين حقيقي — about:blank بيرمي SecurityError
          await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(1800);
          for (const tab of tabs) {
            if (await clickVisibleByText(page, tab, false)) {
              await page.waitForTimeout(1300);
              await runScreen(`academia-${user}-${tab}`, page, theme);
            }
          }
          // المزيد → فريق التحليل / الإعدادات
          if (await clickVisibleByText(page, "المزيد", false)) {
            await page.waitForTimeout(900);
            for (const more of ["فريق التحليل", "الإعدادات", "سجل التدقيق"]) {
              if (await clickVisibleByText(page, more, false)) {
                await page.waitForTimeout(1300);
                await runScreen(`academia-${user}-more-${more}`, page, theme);
              }
            }
          }
          // مساحة عمل الحصة — من الرئيسية افتح أول حصة
          if (await clickVisibleByText(page, "الرئيسية", false)) {
            await page.waitForTimeout(1200);
            const ses = page.locator("button, a").filter({ hasText: /(ابدأ|افتح|استكمال|الحصة)/ }).first();
            if (await ses.isVisible().catch(() => false)) {
              await ses.click().catch(() => {});
              await page.waitForTimeout(2200);
              await runScreen(`academia-${user}-session`, page, theme);
            }
          }
        } catch (e: any) {
          console.error(`  ! academia ${user} [${theme}] فشل: ${e.message?.slice(0, 80)}`);
        }
      }
    }
    await ctx.close();
  }

  await browser.close();

  // ============================================================ report
  const allIssues = results.flatMap((r) => r.issues.map((i) => ({ ...i, page: r.page, theme: r.theme })));
  const realIssues = allIssues.filter((i) => !i.disabled);
  const disabledIssues = allIssues.filter((i) => i.disabled);

  // unique combos across pages
  const byCombo = new Map<string, { ratio: number; fg: string; bg: string; kind: string; large: boolean; pages: string[]; samples: string[] }>();
  for (const i of realIssues) {
    const key = `${i.fg}|${i.bg}|${i.kind}|${i.large}`;
    if (!byCombo.has(key)) byCombo.set(key, { ratio: i.ratio, fg: i.fg, bg: i.bg, kind: i.kind, large: i.large, pages: [], samples: [] });
    const e = byCombo.get(key)!;
    if (!e.pages.includes(`${i.page}[${i.theme}]`)) e.pages.push(`${i.page}[${i.theme}]`);
    for (const s of i.samples) if (e.samples.length < 8 && !e.samples.includes(s)) e.samples.push(s);
  }
  const combos = Array.from(byCombo.values()).sort((a, b) => a.ratio - b.ratio);

  const byPage = new Map<string, number>();
  for (const i of realIssues) {
    const k = `${i.page}[${i.theme}]`;
    byPage.set(k, (byPage.get(k) ?? 0) + 1);
  }

  console.log("\n" + "=".repeat(72));
  console.log(`ملخص: ${results.length} شاشة · ${results.reduce((a, r) => a + r.checked, 0)} نص مفحوص · ${realIssues.length} مشكلة فريدة (${combos.length} توليفة لون) · ${disabledIssues.length} disabled`);
  console.log("=".repeat(72));
  console.log("\n— أعلى الشاشات في المشاكل —");
  for (const [k, v] of Array.from(byPage.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(3)} × ${k}`);
  console.log("\n— أسوأ التوليفات (fg → bg) —");
  for (const c of combos.slice(0, 60)) {
    console.log(`  ${c.ratio.toFixed(2)}:1  ${c.fg} → ${c.bg}  ${c.kind}${c.large ? " (كبير)" : ""}`);
    console.log(`     صفحات: ${c.pages.slice(0, 6).join(" · ")}${c.pages.length > 6 ? " …" : ""}`);
    for (const s of c.samples.slice(0, 3)) console.log(`     · ${s.slice(0, 110)}`);
  }

  fs.writeFileSync(REPORT_JSON, JSON.stringify({ results, combos, disabledIssues }, null, 1), "utf-8");
  console.log(`\nالتقرير الكامل: ${REPORT_JSON}`);
  console.log(`اللقطات: ${OUT_DIR}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
