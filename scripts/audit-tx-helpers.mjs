/** تدقيق المستوى التاني: استدعاءات دوال مساعدة بتستخدم db العام داخليًا من جوه كولباك $transaction
 *  القائمة مبنية على فحص src/lib يدويًا (أي دالة فيها db.<model> مباشرة). */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// دوال الليب اللي جسمها بيستخدم db العام مباشرة (مجموعة من الفحص الساكن)
const DANGEROUS = [
  "generateStudentCode", "assertStudentQuotaTx", "getSubscriptionState",
  "safePlanFeaturesRaw", "logAudit", "recordUndo", "manyBalances",
  "invalidateEntitlements", "requireModule", "requireCenterUser", "requireUser",
  "getEffectiveModules", "getEffectiveModulesForUser", "explainEntitlements",
  "nextReceiptSeq", "balancesFor", "studentBalance", "resolvePermissions",
  "recordAttendanceEvent", "assertAttendanceMethodAllowed", "logRateLimit",
  "rateLimit", "checkRateLimit", "getCenterCapabilities", "requireCapability",
];

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
  let idx = src.indexOf("$transaction");
  while (idx !== -1) {
    const parenIdx = src.indexOf("(", idx);
    const cbOpen = src.indexOf("{", parenIdx);
    if (cbOpen === -1) { idx = src.indexOf("$transaction", idx + 5); continue; }
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
    const lineStart = src.slice(0, cbOpen).split("\n").length;
    for (const fn of DANGEROUS) {
      const re = new RegExp(`(?<![\\w.$])${fn}\\s*\\(`, "g");
      let m;
      while ((m = re.exec(body)) !== null) {
        const before = body.slice(Math.max(0, m.index - 60), m.index);
        if (/\/\/|await\s+tx\.|tx\.\w+\s*=/.test(before) && !new RegExp(`\\b${fn}\\b`).test(before.replace(/\/\/.*/, ""))) { /* noop */ }
        const lineNo = lineStart + body.slice(0, m.index).split("\n").length - 1;
        offenders++;
        const line = body.slice(0, m.index).split("\n").pop() + body.slice(m.index, m.index + 60).split("\n")[0];
        console.log(`${f}:${lineNo}  → ${line.trim().slice(0, 110)}`);
      }
    }
    idx = src.indexOf("$transaction", i);
  }
}
console.log(offenders === 0 ? "✅ نظيف" : `\n⚠️ ${offenders} استدعاء خطر جوه transactions`);
