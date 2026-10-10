/**
 * اختبار المميزات الجديدة — تجربة الموبايل + تسريع الرحلة:
 * 1. PIN: set-pin → pin-login (صح/غلط/قفل) → list-devices → revoke → disable
 * 2. تفضيلات الطباعة التلقائية (update-prefs)
 * 3. التحضير الجماعي (bulk attendance) + الخصومات
 * 4. ذكّر المديونين (queue low_balance)
 * يشتغل على الإنتاج: bun scripts/test-mobile-journey.ts
 */
const BASE = "http://localhost:3000";

let cookie = "";
let passed = 0, failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

async function req(path: string, method = "GET", body?: unknown, useCookie = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(useCookie && cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // سجّل الـ set-cookie دايمًا (حتى لو مش بنبعت cookie في الطلب ده)
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

async function main() {
  console.log("🧪 اختبار PIN + الطباعة التلقائية + التحضير الجماعي + التذكيرات\n");

  // ============ 1. دخول عادي + تفعيل PIN ============
  console.log("— PIN Quick Unlock —");
  let r = await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, false);
  ok("login reception", r.status === 200);
  const firstCookie = cookie;

  // تفعيل PIN على "جهاز" ده
  r = await req("/api/auth", "POST", { action: "set-pin", pin: "4172" });
  ok("set-pin (4172)", r.status === 200 && typeof r.data.deviceToken === "string");
  const deviceToken = r.data.deviceToken as string;
  ok("device label generated", typeof r.data.label === "string" && r.data.label.length > 0, String(r.data.label));

  // pin-login بـ cookie تاني (خروج أولًا)
  cookie = "";
  r = await req("/api/auth", "POST", { action: "pin-login", deviceToken, pin: "4172" }, false);
  ok("pin-login correct PIN", r.status === 200 && !!(r.data.user as Record<string, unknown>)?.name);

  // PIN غلط 5 مرات → قفل
  cookie = "";
  for (let i = 0; i < 5; i++) {
    r = await req("/api/auth", "POST", { action: "pin-login", deviceToken, pin: "0000" }, false);
  }
  ok("5 wrong PINs → error message with lock", r.status === 401 && String(r.data.error).includes("مقفول"), String(r.data.error).slice(0, 50));

  // بعد القفل: حتى الـ PIN الصح مرفوض
  r = await req("/api/auth", "POST", { action: "pin-login", deviceToken, pin: "4172" }, false);
  ok("locked device rejects correct PIN", r.status === 429, `status=${r.status}`);

  // كلمة السر شغالة عادي رغم قفل الجهاز
  r = await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, false);
  ok("password login works while device locked", r.status === 200);

  // list-devices + revoke
  r = await req("/api/auth", "POST", { action: "list-devices" });
  const devices = (r.data.devices as { id: string; label: string }[]) ?? [];
  ok("list-devices shows the device", r.status === 200 && devices.length >= 1, `${devices.length} جهاز`);
  const dev = devices[0];
  r = await req("/api/auth", "POST", { action: "revoke-device", deviceId: dev.id });
  ok("revoke-device", r.status === 200);

  // بعد الإلغاء: pin-login يفشل
  cookie = "";
  r = await req("/api/auth", "POST", { action: "pin-login", deviceToken, pin: "4172" }, false);
  ok("revoked device rejected", r.status === 401);

  // PIN قصير يرفض
  cookie = firstCookie;
  r = await req("/api/auth", "POST", { action: "set-pin", pin: "12" });
  ok("short PIN rejected (2 digits)", r.status === 400);

  // ============ 2. تفضيلات الطباعة التلقائية ============
  console.log("\n— Auto-print prefs —");
  r = await req("/api/auth", "POST", { action: "update-prefs", autoPrintReceipt: true, receiptFormat: "THERMAL" });
  const u = r.data.user as Record<string, unknown> | undefined;
  ok("update-prefs thermal on", r.status === 200 && u?.autoPrintReceipt === true && u?.receiptFormat === "THERMAL");

  r = await req("/api/auth", "POST", { action: "update-prefs", receiptFormat: "A4" });
  ok("update-prefs A4", r.status === 200 && (r.data.user as Record<string, unknown>)?.receiptFormat === "A4");

  r = await req("/api/auth", "POST", { action: "update-prefs", autoPrintReceipt: false, receiptFormat: "THERMAL" });
  ok("update-prefs off (cleanup)", r.status === 200 && (r.data.user as Record<string, unknown>)?.autoPrintReceipt === false);

  // ============ 3. التحضير الجماعي ============
  console.log("\n— Bulk attendance (التحضير المعكوس) —");
  // دخول المدير
  cookie = "";
  r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" }, false);
  ok("login manager", r.status === 200);

  // جهّز وضع التجربة (طلاب 99xxx + حصص النهاردة)
  r = await req("/api/demo", "POST", {});
  ok("demo prepare", r.status === 200 || r.status === 201);

  // هات حصص النهاردة
  r = await req("/api/sessions");
  const sessions = (r.data.sessions as { id: string; status: string; subject: string; groupId: string }[]) ?? [];
  const openSession = sessions.find((s) => s.status === "OPEN");
  ok("found OPEN session", !!openSession, openSession?.subject);

  if (openSession) {
    // حالة الحضور قبل
    r = await req(`/api/sessions/${openSession.id}`);
    const before = r.data as { attendance: unknown[]; absent: { studentId: string }[] };

    // bulk بدون تحديد → كل الغايبين
    r = await req("/api/attendance/mark", "POST", { bulk: true, sessionId: openSession.id });
    const bulk = r.data as { marked: number; totalCharge: number; students: { name: string }[] };
    ok("bulk mark returns count", r.status === 200 && typeof bulk.marked === "number", `marked=${bulk.marked}`);

    // تحقق: مفيش محضروش بعد كده
    r = await req(`/api/sessions/${openSession.id}`);
    const after = r.data as { attendance: unknown[]; absent: { studentId: string }[] };
    ok("absent list empty after bulk", after.absent.length === 0, `قبل: ${before.absent.length} → بعد: ${after.absent.length}`);
    ok("attendance grew correctly", after.attendance.length === before.attendance.length + bulk.marked);
    ok("charge > 0 when students marked", bulk.marked === 0 || bulk.totalCharge > 0, `totalCharge=${bulk.totalCharge}`);

    // bulk تاني = idempotent (مفيش جديد)
    r = await req("/api/attendance/mark", "POST", { bulk: true, sessionId: openSession.id });
    ok("second bulk marks 0", r.status === 200 && (r.data as { marked: number }).marked === 0);
  }

  // bulk على حصة مقفولة → رفض (نجرب على session مقفولة لو موجودة)
  const closedSession = sessions.find((s) => s.status === "CLOSED");
  if (closedSession) {
    r = await req("/api/attendance/mark", "POST", { bulk: true, sessionId: closedSession.id });
    ok("bulk on closed session rejected", r.status === 400, String(r.data.error).slice(0, 40));
  }

  // ============ 4. ذكّر المديونين (queue) ============
  console.log("\n— Debt reminders (queue low_balance) —");
  // شغّل تنبيهات الرصيد الأول
  r = await req("/api/settings", "PATCH", { waLowBalanceEnabled: true });
  ok("enable low-balance alerts", r.status === 200);

  r = await req("/api/queue", "POST", { source: "low_balance", customTitle: "اختبار تذكير — تجاهل" });
  const q = r.data as { created: number; deduped: number };
  ok("low_balance batch created", r.status === 201 && (q.created > 0 || q.deduped > 0), `created=${q.created} deduped=${q.deduped}`);

  // نفس الطلب تاني → dedupe (نفس الشهر)
  r = await req("/api/queue", "POST", { source: "low_balance", customTitle: "اختبار تذكير — تجاهل" });
  const q2 = r.data as { created: number; deduped: number };
  ok("monthly dedupe works", r.status === 201 && q2.created === 0 && q2.deduped > 0, `created=${q2.created} deduped=${q2.deduped}`);

  // قفل الطابور (تنضيف)
  r = await req("/api/queue", "PATCH", { action: "stop" });
  ok("queue stopped (cleanup)", r.status === 200);

  // رجّع الإعداد
  r = await req("/api/settings", "PATCH", { waLowBalanceEnabled: false });
  ok("low-balance alerts back off", r.status === 200);

  // ============ 5. البحث (lookup) لسه شغال ============
  console.log("\n— Lookup sanity —");
  r = await req("/api/lookup?q=10001");
  const students = (r.data.students as { code: string }[]) ?? [];
  ok("lookup by code still works", r.status === 200 && students.some((s) => s.code === "10001"));

  // ============ تنضيف ============
  console.log("\n— Cleanup —");
  r = await req("/api/demo", "DELETE", {});
  ok("demo cleanup", r.status === 200);

  console.log(`\n========== النتيجة: ${passed} ✓ / ${failed} ✗ ==========`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
