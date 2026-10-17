// تحقق إنتاج: #6 PII + ربط المدرس + النطاقات — على سنتر qae-c99-stress بس
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
async function api(cookie, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  console.log("=== تحقق إنتاج: #6 + ربط المدرس ===");
  const mgr = await login("qae-mgr-99");
  const rec = await login("qae-rec-99");
  const tch = await login("qae-tch-99");
  ok("logins", !!mgr && !!rec && !!tch);

  // #6: المدرس مش بيشوف PII الطلاب
  const tList = await api(tch, "/api/students?pageSize=5");
  ok("TEACHER students → 403", tList.status === 403, `got ${tList.status}`);
  const tLookup = await api(tch, "/api/lookup?q=12345");
  ok("TEACHER lookup → 403", tLookup.status === 403, `got ${tLookup.status}`);
  const tScan = await api(tch, "/api/attendance/scan", { method: "POST", body: { query: "12345", sessionId: "x" } });
  ok("TEACHER scan → RED بصلاحية", tScan.status === 200 && tScan.data?.status === "RED" && String(tScan.data?.message || "").includes("صلاحية"), JSON.stringify(tScan.data).slice(0, 90));
  // الاستقبال عادي
  const rList = await api(rec, "/api/students?pageSize=5");
  ok("RECEPTIONIST students → 200", rList.status === 200, `got ${rList.status}`);

  // ربط المدرس بكيانه على سنتر الاختبار: أول مدرس في السنتر
  const staff = await api(mgr, "/api/staff");
  const tchUser = (staff.data.staff ?? []).find((s) => s.username === "qae-tch-99");
  ok("staff فيه teacherRefId", !!tchUser && "teacherRefId" in tchUser);

  // آخر مدرس مش مربوط بحساب — نستخدمه للاختبار ونفك بعدها
  const { Client } = await import("pg");
  const fs = await import("fs");
  const pwd = fs.readFileSync("/home/z/my-project/scripts/.dbpass", "utf8").trim();
  const c = new Client({ host: "aws-0-eu-west-2.pooler.supabase.com", port: 5432, user: "postgres.ttydfyqwzkwivucgiegy", password: pwd, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  const centerId = (await c.query("SELECT \"centerId\" FROM \"User\" WHERE username='qae-tch-99'")).rows[0].centerId;
  let teacher = (await c.query("SELECT t.id, t.name FROM \"Teacher\" t LEFT JOIN \"User\" u ON u.\"teacherRefId\" = t.id WHERE t.\"centerId\"=$1 AND u.id IS NULL AND t.\"isActive\" ORDER BY t.name LIMIT 1", [centerId])).rows[0];
  if (!teacher) {
    // كل المدرسين مربوطين (سنتر الاختبار فيه مدرس واحد غالبًا) — نفك ربط qae-tch-99 نفسه الأول
    await c.query("UPDATE \"User\" SET \"teacherRefId\"=NULL WHERE \"centerId\"=$1 AND role='TEACHER'", [centerId]);
    teacher = (await c.query("SELECT id, name FROM \"Teacher\" WHERE \"centerId\"=$1 AND \"isActive\" ORDER BY name LIMIT 1", [centerId])).rows[0];
  }
  ok("فيه مدرس متاح للربط", !!teacher, JSON.stringify(teacher));

  const link = await api(mgr, "/api/staff", { method: "PATCH", body: { id: tchUser.id, teacherRefId: teacher.id } });
  ok("ربط على الإنتاج → 200", link.status === 200, JSON.stringify(link.data).slice(0, 90));

  // الداشبورد للمربوط: مفيش حصص لمدرس تاني
  const dashT = await api(tch, "/api/dashboard");
  const teachersSeen = new Set([...(dashT.data.sessions ?? []), ...(dashT.data.plannedSessions ?? [])].map((x) => x.teacher).filter((t) => t && t !== "—"));
  const alien = [...teachersSeen].filter((t) => t !== teacher.name);
  ok("داشبورد المربوط: حصصه هو بس", dashT.status === 200 && dashT.data.teacherLinked === true && alien.length === 0, `alien=[${alien.join(",")}] own=[${teacher.name}]`);
  const sessT = await api(tch, "/api/sessions");
  const sTeachers = new Set([...(sessT.data.sessions ?? []), ...(sessT.data.suggestions ?? [])].map((x) => x.teacher).filter((t) => t && t !== "—"));
  const alienS = [...sTeachers].filter((t) => t !== teacher.name);
  ok("sessions المربوط: حصصه هو بس", sessT.status === 200 && alienS.length === 0, `alien=[${alienS.join(",")}]`);

  // فك الربط → فاضي (مش جدول السنتر)
  await api(mgr, "/api/staff", { method: "PATCH", body: { id: tchUser.id, teacherRefId: null } });
  const dashU = await api(tch, "/api/dashboard");
  const sessU = await api(tch, "/api/sessions");
  ok("المش مربوط: قوائم فاضية", dashU.data.teacherLinked === false && (dashU.data.sessions ?? []).length === 0 && (sessU.data.sessions ?? []).length === 0 && (sessU.data.suggestions ?? []).length === 0, JSON.stringify({ d: dashU.data.sessions?.length, s: sessU.data.sessions?.length, g: sessU.data.suggestions?.length }));

  await c.end();
  console.log(`\nالنتيجة: ${pass} نجاح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
