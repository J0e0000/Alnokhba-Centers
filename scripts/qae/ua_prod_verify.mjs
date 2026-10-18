// تحقق إنتاج: اللوحة الموحدة على Vercel — فحص الباندل الجديد + تدفقات أساسية
const BASE = "https://alnokhba-centers-nine.vercel.app";
const results = [];
function ok(name, cond, extra = "") { results.push(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); return cond; }

// 1) السايت شغال
const home = await fetch(BASE + "/", { redirect: "manual" });
ok("home 200", home.status === 200, `status=${home.status}`);

// 2) تسجيل دخول استقبال QAE
const login = await fetch(BASE + "/api/auth", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "qae-rec-99", password: "Qae#2026" }),
  redirect: "manual",
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
ok("login 200", login.status === 200, `status=${login.status}`);

// 3) جلسة صالحة: /api/sessions بيرجع بيانات
const sess = await fetch(BASE + "/api/sessions", { headers: { cookie } });
const sessBody = await sess.json().catch(() => ({}));
ok("sessions api", sess.status === 200, `sessions=${(sessBody.sessions ?? []).length}`);

// 4) autoRoute: كود غير موجود → RED (وبلاش كراش)
const scan1 = await fetch(BASE + "/api/attendance/scan", {
  method: "POST", headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({ query: "00000", autoRoute: true }),
});
const s1 = await scan1.json().catch(() => ({}));
ok("scan bad-code RED", scan1.status === 200 && s1.status === "RED", `status=${s1.status}`);

// 5) autoRoute: كود صحيح من سنتر QAE (لو فيه) → GREEN مع autoHint أو session
// ناخد كود من الطلاب الفعليين
const students = await fetch(BASE + "/api/students?pageSize=5", { headers: { cookie } });
const stBody = await students.json().catch(() => ({}));
const firstCode = stBody.students?.[0]?.code;
if (firstCode) {
  const scan2 = await fetch(BASE + "/api/attendance/scan", {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ query: String(firstCode), autoRoute: true }),
  });
  const s2 = await scan2.json().catch(() => ({}));
  ok("scan real-code GREEN", scan2.status === 200 && s2.status === "GREEN", `code=${firstCode} session=${s2.session ? "found" : "none"} hint=${s2.autoHint?.kind ?? "none"}`);
} else {
  ok("scan real-code GREEN", false, "no students found in QAE center");
}

console.log(results.join("\n"));
const pass = results.every((r) => r.startsWith("✅"));
console.log(pass ? "\n=== ALL PASS ===" : "\n=== SOME FAILED ===");
process.exit(pass ? 0 : 1);
