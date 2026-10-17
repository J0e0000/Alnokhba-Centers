// تحقق إنتاج: زرار حزمة الطوارئ (?package=1) بيرجّع HTML موقّع مش {history:[]}
const BASE = process.env.QAE_BASE || "https://alnokhba-centers-nine.vercel.app";
const PWD = "Qae#2026";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
async function login(username, password = PWD) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get("set-cookie") ?? "").match(/nokhba_session=[^;]+/)?.[0] ?? "";
}
async function raw(cookie, path) {
  return fetch(`${BASE}${path}`, { headers: { cookie } });
}

(async () => {
  console.log("=== تحقق إنتاج: حزمة الطوارئ package=1 ===");
  const mgr = await login("qae-mgr-99");
  ok("login qae-mgr-99", !!mgr);

  // 1) ?package=1 → HTML package
  const p1 = await raw(mgr, "/api/emergency?package=1");
  const body1 = await p1.text();
  const cd1 = p1.headers.get("content-disposition") ?? "";
  ok("package=1 → 200", p1.status === 200, `got ${p1.status}`);
  ok("content-type text/html", (p1.headers.get("content-type") ?? "").includes("text/html"), p1.headers.get("content-type") ?? "");
  ok("attachment filename NOKHBA-OFFLINE-*.html", /NOKHBA-OFFLINE-\d{4}-\d{2}-\d{2}\.html/i.test(cd1), cd1);
  ok("مش JSON تاريخ فاضي", !body1.trim().startsWith('{"history"'), body1.slice(0, 60));
  ok("حزمة HTML فيها snapshot موقّع", body1.includes("ALNOKHBA") && body1.length > 40000, `len=${body1.length}`);

  // 2) ?export=1 → لسه HTML (سلوك قديم محفوظ)
  const p2 = await raw(mgr, "/api/emergency?export=1");
  const body2 = await p2.text();
  ok("export=1 → HTML برضه", p2.status === 200 && (p2.headers.get("content-type") ?? "").includes("text/html"), `got ${p2.status}`);

  // 3) ?export=1&format=xlsx → إكسل الأسبوع
  const p3 = await raw(mgr, "/api/emergency?export=1&format=xlsx");
  const buf3 = Buffer.from(await p3.arrayBuffer());
  ok("export xlsx → 200 + xlsx magic PK", p3.status === 200 && buf3.subarray(0, 2).toString() === "PK", `got ${p3.status} magic=${buf3.subarray(0, 2).toString()}`);

  // 4) من غير بارامترات → سجل المزامنات (history) زي ما هو
  const p4 = await raw(mgr, "/api/emergency");
  const d4 = await p4.json().catch(() => null);
  ok("GET عادي → history JSON", p4.status === 200 && Array.isArray(d4?.history), `got ${p4.status}`);

  // 5) جرب لوجين قديم للسنترات الحقيقية مش هيبوظ — استقبال QAE عنده حق التصدير؟ (requireManager)
  const rec = await login("qae-rec-99");
  const p5 = await raw(rec, "/api/emergency?package=1");
  console.log(`  ℹ️ RECEPTIONIST package=1 → ${p5.status} (سلوك requireManager الحالي)`);

  console.log(`\nالنتيجة: ${pass} صح / ${fail} غلط`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
