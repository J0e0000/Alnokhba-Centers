/**
 * اختبار بورتال الطالب — API:
 * 1. دخول بالكود + الموبايل (تطبيع الأرقام العربية + الغلط)
 * 2. الرئيسية: QR + الكود + أقرب حصة + عدد الإشعارات
 * 3. جدولي: 7 أيام من تسجيلات الطالب
 * 4. الإعلانات والإشعارات + تحديد مقروء
 * 5. Push: مفتاح VAPID بيتولد
 * 6. العزل: جلسة الطالب مش بتفتح APIs الموظفين
 * npx tsx scripts/test-portal.ts
 */
const BASE = "http://localhost:3000";

let cookie = ""; // portal cookie
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
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

async function main() {
  console.log("🧪 اختبار بورتال الطالب (portal)\n");

  // ============ 1. بدون جلسة ============
  console.log("— بدون تسجيل دخول —");
  cookie = "";
  let r = await req("/api/portal");
  ok("GET /api/portal → student null", r.status === 200 && r.data.student === null);

  // ============ 2. دخول غلط ============
  console.log("\n— دخول غلط —");
  r = await req("/api/portal", "POST", { action: "login", code: "10002", phone: "01000000000" }, false);
  ok("wrong phone rejected", r.status === 401, String(r.data.error ?? "").slice(0, 40));
  r = await req("/api/portal", "POST", { action: "login", code: "99999", phone: "01055552222" }, false);
  ok("unknown code rejected", r.status === 401);
  r = await req("/api/portal", "POST", { action: "login", code: "100", phone: "01055552222" }, false);
  ok("bad code format rejected", r.status === 401);

  // ============ 3. دخول صح (بالأرقام العربية) ============
  console.log("\n— دخول بالأرقام العربية ٤٨٢٩١ —");
  // طالب من سنتر النخبة: نستخدم كود 10002 + موبايله — ب_ARABIC INDIC digits
  const arabicCode = "١٠٠٠٢".replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  r = await req("/api/portal", "POST", { action: "login", code: "١٠٠٠٢", phone: "٠١٠٥٥٥٥٢٢٢٢" }, false);
  ok("login with Arabic-Indic digits", r.status === 200, `code=${arabicCode}`);

  // ============ 4. الرئيسية ============
  console.log("\n— الرئيسية —");
  r = await req("/api/portal");
  const student = r.data.student as { name: string; code: string; qrDataUrl: string; gradeName: string | null; center: { name: string } } | null;
  ok("student data", !!student && student.code === "10002", student?.name);
  ok("QR data URL generated", !!student?.qrDataUrl?.startsWith("data:image/png;base64,"));
  ok("center branding name", student?.center?.name === "مركز النخبة التعليمي");
  ok("today date present", typeof r.data.today === "string" && r.data.today.length === 10);
  const unread0 = (r.data.unread as number) ?? -1;
  ok("unread count present", unread0 >= 0);
  ok("student balance present", typeof r.data.balance === "number", `balance=${r.data.balance} ج`);

  // ============ 5. جدولي ============
  console.log("\n— جدولي —");
  r = await req("/api/portal/schedule");
  const week = (r.data.week as { dayName: string; isToday: boolean; lessons: { subject: string; startTime: string }[] }[]) ?? [];
  ok("week has 7 days", week.length === 7, week.map((d) => d.dayName).join("،"));
  ok("today flagged", week.some((d) => d.isToday));
  const totalLessons = week.reduce((a, d) => a + d.lessons.length, 0);
  ok("lessons from registrations", totalLessons > 0, `${totalLessons} حصة أسبوعيًا`);
  const subjects = (r.data.subjects as string[]) ?? [];
  ok("subjects list", subjects.length > 0, subjects.join("،"));

  // ============ 6. الرسايل (إعلانات + إشعارات في مكان واحد) ============
  console.log("\n— الرسايل —");
  r = await req("/api/portal/announcements");
  ok("announcements list ok", r.status === 200 && Array.isArray(r.data.announcements));

  // ============ 7. الإشعارات (جوّه الرسايل) ============
  console.log("\n— الإشعارات —");
  r = await req("/api/portal/notifications");
  const notifications = (r.data.notifications as { id: string; type: string; read: boolean; typeMeta: { icon: string } }[]) ?? [];
  const unread1 = (r.data.unread as number) ?? 0;
  ok("notifications list ok", r.status === 200 && Array.isArray(notifications));
  if (notifications.length > 0) {
    ok("type metadata attached", notifications.every((n) => n.typeMeta?.icon));
    // read one
    const first = notifications.find((n) => !n.read) ?? notifications[0];
    r = await req("/api/portal/notifications", "POST", { action: "read", id: first.id });
    ok("mark one read", r.status === 200);
    r = await req("/api/portal/notifications");
    ok("unread decreased or stayed 0", ((r.data.unread as number) ?? 0) <= unread1);
    // readAll
    r = await req("/api/portal/notifications", "POST", { action: "readAll" });
    ok("mark all read", r.status === 200);
    r = await req("/api/portal/notifications");
    ok("unread is now 0", (r.data.unread as number) === 0);
    ok("all marked read", (r.data.notifications as { read: boolean }[]).every((n) => n.read));
  } else {
    console.log("  ⚠️ مفيش إشعارات لسه — شغّل test-announcements الأول");
  }

  // ============ 8. Push ============
  console.log("\n— Push —");
  r = await req("/api/portal/push");
  const publicKey = r.data.publicKey as string | null;
  ok("VAPID public key generated", typeof publicKey === "string" && publicKey.length > 60);
  // اشتراك وهمي بيتشال بعد الاختبار
  r = await req("/api/portal/push", "POST", {
    subscription: { endpoint: "https://test.example.push/123", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } },
  });
  ok("push subscription stored", r.status === 200);
  r = await req(`/api/portal/push?endpoint=${encodeURIComponent("https://test.example.push/123")}`, "DELETE");
  ok("push subscription removed", r.status === 200);

  // ============ 9. العزل الأمني ============
  console.log("\n— العزل الأمني —");
  r = await req("/api/students", "GET", undefined, true);
  ok("portal session can't open staff APIs", r.status === 401, `status=${r.status}`);
  r = await req("/api/announcements");
  ok("portal session can't list manager announcements", r.status === 401 || r.status === 403, `status=${r.status}`);

  // ============ 10. خروج ============
  console.log("\n— خروج —");
  r = await req("/api/portal", "POST", { action: "logout" });
  ok("logout ok", r.status === 200);
  r = await req("/api/portal");
  ok("session destroyed", r.data.student === null);

  // ============ النتيجة ============
  console.log(`\n${"=".repeat(50)}`);
  console.log(`النتيجة: ${passed} ✓ / ${failed} ✗`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
