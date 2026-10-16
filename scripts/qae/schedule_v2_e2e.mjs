// e2e لجدول v2 — تعارض/تأكيد/قفل تزامن — على الـ dev server
// تشغيل: bun scripts/qae/schedule_v2_e2e.mjs
const BASE = process.env.QAE_BASE || "http://127.0.0.1:3000";
const MGR = { username: "qae-mgr-ob", password: "Qae#2026" };
const CID = "cmvbb396y0000ovy9n6gmecjy"; // QAE1 (dev)

let cookie = "";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") ?? "" };
}

async function main() {
  console.log("=== e2e جدول v2 ===");
  // 1) دخول
  const login = await api("/api/auth", { method: "POST", body: MGR });
  const setCookie = login.setCookie ?? "";
  cookie = (setCookie.match(/nokhba_session=[^;]+/) ?? [""])[0];
  ok("login", login.status === 200 && !!cookie, `status=${login.status}`);

  // 2) الجدول الحالي
  const sched = await api("/api/schedule");
  ok("GET /api/schedule 200", sched.status === 200);
  const allSlots = sched.data.days.flatMap((d) => d.slots.map((s) => ({ ...s, dayOfWeek: d.dayOfWeek })));
  ok("slots فيها updatedAt", allSlots.length === 0 || typeof allSlots[0].updatedAt === "string");
  const withRoom = allSlots.filter((s) => s.room);
  const seedSlot = withRoom[0] ?? allSlots[0];
  if (!seedSlot) { console.log("مفيش حصص في السنتر للاختبار — exit"); process.exit(1); }

  // 3) تعارض مدرس بدون تأكيد → 409 needsConfirm
  const payload = {
    dayOfWeek: seedSlot.dayOfWeek,
    startTime: seedSlot.startTime,
    endTime: seedSlot.endTime,
    groupId: seedSlot.groupId,
    room: seedSlot.room ?? undefined,
  };
  const c1 = await api("/api/schedule", { method: "POST", body: payload });
  ok("POST متعارض → 409 needsConfirm", c1.status === 409 && c1.data.needsConfirm === true, JSON.stringify(c1.data).slice(0, 200));
  const conflictTypes = (c1.data.conflicts ?? []).map((c) => c.type);
  ok("التعارض مفسّر (TEACHER/ROOM/DUPLICATE)", conflictTypes.length > 0, JSON.stringify(conflictTypes));

  // 4) نفس الطلب بتأكيد + سبب → 201
  const c2 = await api("/api/schedule", {
    method: "POST",
    body: { ...payload, confirmConflict: true, conflictReason: "اختبار e2e — المدرس موافق" },
  });
  ok("POST بتأكيد → 201", c2.status === 201, JSON.stringify(c2.data).slice(0, 200));
  const newId = c2.data?.slot?.id;
  ok("الرد فيه updatedAt", typeof c2.data?.slot?.updatedAt === "string");
  ok("overrides=true", c2.data?.overrides === true);

  // 5) lastOverrideAt اتسجل
  const sched2 = await api("/api/schedule");
  const fresh = sched2.data.days.flatMap((d) => d.slots).find((s) => s.id === newId);
  ok("الحصة الجديدة موجودة", !!fresh);
  ok("lastOverrideAt متسجل", !!fresh?.lastOverrideAt);

  // 6) PATCH قديم (stale) → 409 stale
  const stalePatch = await api("/api/schedule", {
    method: "PATCH",
    body: { id: newId, updatedAt: "2000-01-01T00:00:00.000Z", startTime: "08:00", endTime: "10:00" },
  });
  ok("PATCH stale → 409", stalePatch.status === 409 && stalePatch.data.stale === true, JSON.stringify(stalePatch.data).slice(0, 150));

  // 7) تزامن: PATCHين بنفس updatedAt — الأول نجاح والتاني stale
  const cur = sched2.data.days.flatMap((d) => d.slots).find((s) => s.id === newId);
  const p1 = api("/api/schedule", { method: "PATCH", body: { id: newId, updatedAt: cur.updatedAt, startTime: "08:00", endTime: "10:00" } });
  const p2 = api("/api/schedule", { method: "PATCH", body: { id: newId, updatedAt: cur.updatedAt, startTime: "10:00", endTime: "12:00" } });
  const [r1, r2] = await Promise.all([p1, p2]);
  const statuses = [r1.status, r2.status].sort();
  ok("PATCHين متزامنين: واحد نجح وواحد stale 409", statuses[0] === 200 && statuses[1] === 409, `statuses=${statuses}`);

  // 8) PATCH سليم بدون تعارض → 200
  const sched3 = await api("/api/schedule");
  const cur2 = sched3.data.days.flatMap((d) => d.slots).find((s) => s.id === newId);
  const r3 = await api("/api/schedule", {
    method: "PATCH",
    body: { id: newId, updatedAt: cur2.updatedAt, startTime: "20:00", endTime: "22:00", room: cur2.room },
  });
  ok("PATCH سليم → 200", r3.status === 200, JSON.stringify(r3.data).slice(0, 150));

  // 9) تداخل فتري حقيقي: حصة 4 ساعات ضد حصة داخل أي بلوك منها
  //    نجيب حصة تانية لنفس المدرس في نفس اليوم وقت مختلف → تعارض يتحسب
  const cur3 = (await api("/api/schedule")).data.days.flatMap((d) => d.slots).find((s) => s.id === newId);
  const teacherSlot = allSlots.find((s) => s.teacherId && s.teacherId === seedSlot.teacherId && s.id !== newId && s.dayOfWeek === seedSlot.dayOfWeek);
  if (teacherSlot) {
    const c4 = await api("/api/schedule", {
      method: "POST",
      body: { dayOfWeek: teacherSlot.dayOfWeek, startTime: teacherSlot.startTime, endTime: teacherSlot.endTime, groupId: seedSlot.groupId, confirmConflict: false },
    });
    const types = (c4.data?.conflicts ?? []).map((c) => c.type);
    ok("كشف مدرس بالتداخل الفتري", c4.status === 409 && types.includes("TEACHER"), JSON.stringify(types));
  } else {
    console.log("  ⚠️ مفيش حصة تانية لنفس المدرس — بتخطى اختبار التداخل الفتري");
  }

  // 10) تنظيف: إلغاء الحصة المضافة (soft delete)
  const del = await api(`/api/schedule?id=${newId}`, { method: "DELETE" });
  ok("DELETE تنظيف → 200", del.status === 200);

  console.log(`\n=== النتيجة: ${pass} نجاح / ${fail} فشل ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
