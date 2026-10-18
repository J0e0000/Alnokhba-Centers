// فحص سريع لملفات النماذج: البنية + استخراج السكريبت المدمج وفحص syntax بـ node
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const files = ["index.html", "1.html", "2.html", "3.html", "4.html"];
let fail = 0;

for (const f of files) {
  const p = `/home/z/my-project/public/prototypes/${f}`;
  const html = readFileSync(p, "utf8");
  const checks = [
    ['dir="rtl"', html.includes('dir="rtl"')],
    ["meta viewport", html.includes("name=\"viewport\"")],
    ["noindex", html.includes("noindex")],
    ["closing html", html.trim().endsWith("</html>")],
    ["no external scripts", !/script[^>]+src=["']https?:/.test(html)],
    ["no external css", !/link[^>]+href=["']https?:\/\//.test(html)],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (bad.length) { console.log(`❌ ${f}: ${bad.join(", ")}`); fail++; }
  else console.log(`✅ ${f}: بنية سليمة (${(html.length / 1024).toFixed(1)}KB)`);

  // فحص syntax للسكريبت المدمج
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (m) {
    const tmp = `/tmp/proto-check-${f.replace(".", "_")}.js`;
    writeFileSync(tmp, m[1]);
    try {
      execSync(`node --check ${tmp}`, { stdio: "pipe" });
      console.log(`   ✅ JS syntax سليم`);
    } catch (e) {
      console.log(`   ❌ JS خطأ: ${e.stderr?.toString().slice(0, 300)}`);
      fail++;
    }
    try { unlinkSync(tmp); } catch {}
  }
}

process.exit(fail ? 1 : 0);
