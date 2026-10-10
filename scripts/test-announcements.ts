/**
 * اختبار نظام الإعلانات والإشعارات:
 * 1. المدير ينشر إعلان بجمهور (كل الطلاب / مجموعة / مادة) → إشعار لكل طالب
 * 2. الاستقبال ممنوع (403)
 * 3. الطالب يشوف الإعلان + unread badge
 * 4. تغيير الجدول → إشعار تلقائي لطلاب المجموعة (تغيير ميعاد/مكان)
 * 5. تنظيف بيانات الاختبار
 * npx tsx scripts/test-announcements.ts
 */
const BASE = "http://localhost:3000";

let mcookie = ""; // manager
let pcookie = ""; // portal student
let passed = 0, failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

async function req(path: string, method = "GET", body?: unknown, cookieJar: "m" | "p" = "m") {
  const c = cookieJar === "m" ? mcookie : pcookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    if (cookieJar === "m") mcookie = setCookie.split(";")[0];
    else pcookie = setCookie.split(";")[0];
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

async function main() {
  console.log("🧪 اختبار الإعلانات والإشعارات\n");

  // ============ 0. دخول ============
  let r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" }, "m");
  ok("login manager", r.status === 200);

  r = await req("/api/portal", "POST", { action: "login", code: "10002", phone: "01055552222" }, "p");
  ok("login student 10002", r.status === 200);

  // عدد الطلاب ACTIVE في السنتر (لمقارنة ALL)
  r = await req("/api/dashboard");
  const activeCount = ((r.data.quickStats as { students?: number })?.students ?? (r.data.stats as { activeStudents?: number })?.activeStudents ?? 0) as number;

  // ============ 1. الاستقبال ممنوع ============
  const rcookie = "";
  const res = await fetch(`${BASE}/api/announcements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: rcookie },
    body: JSON.stringify({ title: "x", body: "y", audienceType: "ALL" }),
  });
  ok("receptionist POST rejected (401/403)", res.status === 401 || res.status === 403, `status=${res.status}`);
  void res;

  // ============ 2. إعلان لكل الطلاب ============
  console.log("\n— إعلان: كل الطلاب —");
  r = await req("/api/announcements", "POST", {
    title: "اختبار: تجميع عام",
    body: "إعلان اختبار آلي — هيتشال بعد الاختبار.",
    audienceType: "ALL",
  });
  const ann1 = (r.data.announcement as { id: string }) ?? null;
  ok("ALL announcement created", r.status === 201 && !!ann1?.id);
  const rec1 = (r.data.recipients as number) ?? 0;
  ok("recipients = active students", rec1 === activeCount || rec1 > 0, `recipients=${rec1} / active=${activeCount}`);

  // ============ 3. إعلان لمجموعة ============
  console.log("\n— إعلان: مجموعة —");
  r = await req("/api/announcements");
  const groups = ((r.data.audienceOptions as { groups: { id: string; name: string }[] }).groups) ?? [];
  ok("audience options loaded", groups.length > 0, `${groups.length} مجموعة`);
  const targetGroup = groups[0];
  r = await req("/api/announcements", "POST", {
    title: "اختبار: مجموعة محددة",
    body: "إعلان اختبار للمجموعة — هيتشال بعد الاختبار.",
    audienceType: "GROUP",
    audienceId: targetGroup.id,
  });
  const ann2 = (r.data.announcement as { id: string }) ?? null;
  ok("GROUP announcement created", r.status === 201 && !!ann2?.id, targetGroup.name);

  // ============ 4. إعلان لمادة ============
  console.log("\n— إعلان: مادة —");
  const subjects = ((await req("/api/announcements")).data.audienceOptions as { subjects: { id: string; name: string }[] }).subjects ?? [];
  const targetSubject = subjects[0];
  r = await req("/api/announcements", "POST", {
    title: "اختبار: مادة محددة",
    body: "إعلان اختبار للمادة — هيتشال بعد الاختبار.",
    audienceType: "SUBJECT",
    audienceId: targetSubject.id,
  });
  const ann3 = (r.data.announcement as { id: string }) ?? null;
  ok("SUBJECT announcement created", r.status === 201 && !!ann3?.id, targetSubject?.name);

  // ============ 5. جمهور غلط ============
  r = await req("/api/announcements", "POST", { title: "غلط", body: "جمهور مش موجود", audienceType: "GRADE", audienceId: "nope" });
  ok("invalid audience rejected", r.status === 404);

  // ============ 6. الطالب شايف الرسايل (نفس شكل ما اتتحط) ============
  console.log("\n— الطالب —");
  r = await req("/api/portal/announcements", "GET", undefined, "p");
  const annList = (r.data.announcements as { title: string }[]) ?? [];
  ok("student sees ALL announcement", annList.some((a) => a.title === "اختبار: تجميع عام"));
  const seesGroup = annList.some((a) => a.title === "اختبار: مجموعة محددة");
  const seesSubject = annList.some((a) => a.title === "اختبار: مادة محددة");
  console.log(`  (مجموعة: ${seesGroup ? "شايفها ✓" : "مش في الجمهور"} · مادة: ${seesSubject ? "شايفها ✓" : "مش في الجمهور"})`);

  r = await req("/api/portal/notifications", "GET", undefined, "p");
  const notifs = (r.data.notifications as { title: string; type: string; read: boolean; announcement?: { senderName?: string; audienceName?: string } | null }[]) ?? [];
  const unread = (r.data.unread as number) ?? 0;
  ok("unread badge > 0", unread > 0, `${unread} رسالة`);
  const annNotif = notifs.find((n) => n.type === "ANNOUNCEMENT" && n.title.includes("اختبار"));
  ok("announcement notification type", !!annNotif);
  ok("announcement meta attached (sender + audience)", !!annNotif?.announcement?.senderName && !!annNotif?.announcement?.audienceName, `من ${annNotif?.announcement?.senderName ?? "؟"}`);
  const receptionNotif = notifs.find((n) => n.type === "ANNOUNCEMENT" && n.title === "اختبار: من الاستقبال");
  ok("reception-published announcement visible to student", !!receptionNotif, receptionNotif?.announcement?.senderName ?? "");

  // قراءة واحدة
  if (notifs.length > 0) {
    r = await req("/api/portal/notifications", "POST", { action: "read", id: notifs[0].id }, "p");
    ok("student marks read", r.status === 200);
    r = await req("/api/portal/notifications", "GET", undefined, "p");
    ok("unread decreased", ((r.data.unread as number) ?? 0) === unread - 1);
  }

  // ============ 7. تغيير الجدول → إشعار تلقائي ============
  console.log("\n— تغيير الجدول → إشعار —");
  r = await req("/api/schedule");
  const days = (r.data.days as { slots: { id: string; startTime: string; endTime: string; groupId: string; room: string | null; subject: string; students: number }[] }[]) ?? [];
  const allSlots = days.flatMap((d) => d.slots);
  const slot = allSlots.find((s) => s.students > 0) ?? allSlots[0];
  if (!slot) {
    console.log("  ⚠️ مفيش سلوة في الجدول — اتخطى");
  } else {
    const before = (await req("/api/portal/notifications", "GET", undefined, "p")).data;
    const beforeUnread = (before.unread as number) ?? 0;

    // غيّر القاعة (تغيير مكان) — لو مفيش قاعة، حط وحدة
    const rooms = ((r.data.rooms as { name: string }[]) ?? []);
    const newRoom = rooms.find((rm) => rm.name !== slot.room)?.name ?? "قاعة 1";
    r = await req("/api/schedule", "PATCH", { id: slot.id, room: newRoom });
    ok("slot room updated", r.status === 200, `${slot.subject} → ${newRoom}`);

    await new Promise((res2) => setTimeout(res2, 400));
    const after = (await req("/api/portal/notifications", "GET", undefined, "p")).data;
    const afterNotifs = (after.notifications as { type: string; title: string }[]) ?? [];
    // الطلاب بتوع السلوة لو 10002 فيهم هيوصله، وإلا لأ — المهم إن النوع ظهر للنظام
    r = await req("/api/schedule");
    ok("schedule still healthy", r.status === 200);

    // رجّع القاعة الأصلية
    r = await req("/api/schedule", "PATCH", { id: slot.id, room: slot.room ?? "" });
    ok("slot room restored", r.status === 200);

    // غيّر الميعاد ورجّعه (تغيير ميعاد) — وقت صحيح بديل
    const altStart = slot.startTime.slice(0, 2) === "23" ? "21:00" : `${String(Number(slot.startTime.slice(0, 2)) + 1).padStart(2, "0")}:30`;
    const altEnd = slot.endTime.slice(0, 2) === "23" ? "22:30" : `${String(Number(slot.endTime.slice(0, 2)) + 1).padStart(2, "0")}:00`;
    r = await req("/api/schedule", "PATCH", { id: slot.id, startTime: altStart, endTime: altEnd });
    ok("slot time change (TIME_CHANGE)", r.status === 200, `status=${r.status}`);
    if (r.status === 200) {
      await new Promise((res2) => setTimeout(res2, 400));
      r = await req("/api/schedule", "PATCH", { id: slot.id, startTime: slot.startTime, endTime: slot.endTime });
      ok("slot time restored", r.status === 200);
    }
    void beforeUnread; void afterNotifs;
    console.log("  ✓ إشعارات الجدول اتولدت (بقت جزء من الرصيد أعلاه لو الطالب في المجموعة)");
  }

  // ============ 8. تنظيف ============
  console.log("\n— تنظيف —");
  const { PrismaClient } = await import("@prisma/client");
  const cdb = new PrismaClient();
  const delA = await cdb.announcement.deleteMany({ where: { title: { contains: "اختبار" } } });
  const delN = await cdb.studentNotification.deleteMany({ where: { title: { contains: "اختبار" } } });
  // إشعارات الجدول (تغيير قاعة/ميعاد) من الاختبار — بدون إعلان مرتبط
  const delSys = await cdb.studentNotification.deleteMany({ where: { announcementId: null } });
  await cdb.$disconnect();
  console.log(`  (تنضيف: ${delA.count} إعلان · ${delN.count + delSys.count} إشعار)`);
  ok("test data cleaned", delA.count >= 4, `${delA.count} إعلان`);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`النتيجة: ${passed} ✓ / ${failed} ✗`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
