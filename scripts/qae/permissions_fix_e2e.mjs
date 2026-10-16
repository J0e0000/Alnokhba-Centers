// e2e لإصلاحات الصلاحيات (المرحلة 2) — الرفض المفروض يشتغل
// تشغيل: bun scripts/qae/permissions_fix_e2e.mjs
const BASE = process.env.QAE_BASE || "http://127.0.0.1:3000";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function login(username, password = "Qae#2026") {
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

async function main() {
  console.log("=== e2e إصلاحات الصلاحيات ===");
  const mgr = await login("qae-mgr-ob");

  // حامل دور TEACHER (موظف مدرس — مفيش صلاحيات) + استقبال محدود بدون END_SESSION
  const recLimited = await login("qae-recl-ob");

  // 1) جلسة TEACHER-role: أفتح حساب TEACHER مؤقت
  const t = await api(mgr, "/api/schedule"); // sanity
  ok("mgr schedule 200", t.status === 200);

  // تسجيل مستخدم TEACHER-role للاختبار (لو مش موجود)
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const hash = (await import("crypto")).default;
  const salt = hash.randomBytes(16).toString("hex");
  const pwd = `scrypt:${salt}:${hash.scryptSync("Qae#2026", salt, 64).toString("hex")}`;
  let tch = await db.user.findUnique({ where: { username: "qae-tch-ob" } });
  if (!tch) {
    tch = await db.user.create({
      data: { username: "qae-tch-ob", name: "QAE1 مدرس اختبار", role: "TEACHER", passwordHash: pwd, centerId: "cmvbb396y0000ovy9n6gmecjy", isActive: true },
    });
  } else {
    await db.user.update({ where: { id: tch.id }, data: { passwordHash: pwd, isActive: true } });
  }
  await db.$disconnect();
  const tchCookie = await login("qae-tch-ob");
  ok("teacher login", !!tchCookie);

  // 2) TEACHER يفتح حصة → 403
  const open1 = await api(tchCookie, "/api/sessions", { method: "POST", body: { groupId: "x", startTime: "10:00", endTime: "12:00" } });
  ok("TEACHER فتح حصة → 403", open1.status === 403, `got ${open1.status}`);

  // 3) TEACHER ينشر إعلان → 403
  const ann1 = await api(tchCookie, "/api/announcements", { method: "POST", body: { title: "اختبار", body: "نص اختبار", audience: "ALL" } });
  ok("TEACHER إعلان → 403", ann1.status === 403, `got ${ann1.status}`);

  // 4) TEACHER مسح حضور → 403 (EDIT_ATTENDANCE مش عنده)
  const del1 = await api(tchCookie, "/api/attendance/mark?attendanceId=nonexistent", { method: "DELETE" });
  ok("TEACHER مسح حضور → 403", del1.status === 403, `got ${del1.status}`);

  // 5) المدير download=latest لقاعدة البيانات → 403 (متاحة للأدمن بس)
  const db1 = await api(mgr, "/api/backup?download=latest");
  ok("مدير تنزيل .db → 403", db1.status === 403, `got ${db1.status}`);

  // 6) المدير JSON export لسنتره → 200
  const json1 = await api(mgr, "/api/backup?format=json");
  ok("مدير JSON export → 200", json1.status === 200, `got ${json1.status}`);

  // 7) الاستقبال المحدود: هل عنده END_SESSION؟ حسب الافتراضي عنده — نجيب حالته
  const recSess = await api(recLimited, "/api/sessions");
  ok("استقبال limited GET sessions → 200", recSess.status === 200, `got ${recSess.status}`);

  // 8) TEACHER dashboard → simple payload (مش مالي)
  const dash1 = await api(tchCookie, "/api/dashboard");
  ok("TEACHER dashboard → 200 بدون مالي", dash1.status === 200 && dash1.data?.role !== "MANAGER" && dash1.data?.revenue === undefined, JSON.stringify(Object.keys(dash1.data ?? {})).slice(0, 120));

  console.log(`\n=== النتيجة: ${pass} نجاح / ${fail} فشل ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
