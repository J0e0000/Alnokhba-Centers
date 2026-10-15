/** تدقيق: أي استخدام لـ db. العام جوه كولباك $transaction = deadlock محتمل على pool باتصال واحد
 *  بيمشي على الأقواس المتوازنة عشان يحدد جسم الكولباك بدقة. */
import fs from "fs";
import path from "path";

const ROOTS = ["src/app/api", "src/lib", "src/ai"];
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
}
for (const r of ROOTS) if (fs.existsSync(r)) walk(r);

let offenders = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (!src.includes("$transaction")) continue;
  const lines = src.split("\n");
  // ابحث عن كل db.$transaction(
  let idx = src.indexOf("db.$transaction");
  while (idx !== -1) {
    // حدد بداية الكولباك: async (tx) => {  أو  (tx) => {
    const cbOpen = src.indexOf("{", src.indexOf("(", idx + "db.$transaction".length));
    if (cbOpen === -1) { idx = src.indexOf("db.$transaction", idx + 5); continue; }
    // امشِ على الأقواس المتوازنة
    let depth = 0, i = cbOpen, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i], prev = src[i - 1];
      if (inStr) { if (c === inStr && prev !== "\\") inStr = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "{") depth++;
      else if (c === ")") { if (depth === 0) break; }
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    const body = src.slice(cbOpen, i);
    // سطور جسم الكولباك اللي فيها db.<model>. — استبعاد tx. والتعليقات
    const lineStart = src.slice(0, cbOpen).split("\n").length;
    const bodyLines = body.split("\n");
    bodyLines.forEach((ln, k) => {
      const t = ln.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      const m = t.match(/\bdb\.([a-zA-Z_$]+[\.$])/);
      if (m && !/\btx\b|\$transaction/.test(t.slice(0, m.index + 1)) === false) { /* noop */ }
      if (/\bdb\.\w+[\.(]/.test(t) && !/db\.\$/.test(t)) {
        const lineNo = lineStart + k - 1;
        offenders++;
        console.log(`${f}:${lineNo}  → ${t.slice(0, 110)}`);
      }
    });
    idx = src.indexOf("db.$transaction", i);
  }
}
console.log(offenders === 0 ? "✅ مفيش أي قراءة عامة جوه أي transaction" : `\n⚠️ ${offenders} سطر خطير`);
