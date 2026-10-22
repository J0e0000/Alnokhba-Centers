/**
 * اختبارات التحويلات — المرحلة 6 (تنبيهات ذكية) + المرحلة 8 (لينكات واتساب).
 * ------------------------------------------------------------
 * التحقق من: بوابة صلاحيات /api/alerts + كشف المديونية + أيام الخزنة المفتوحة
 * + الحصص غير المقفولة + طلبات الموافقة القديمة + غياب 3 حصص متتالية
 * + الـ cron اليومي (dedupe) + تحقق لينكات الواتساب (قبول/رفض/مسح).
 * سيرفر معزول بقاعدة SQLite مؤقتة — صفر لمس لأي بيانات حقيقية.
 * التشغيل: npm run build ثم npx tsx scripts/spec-tests/hardening-final.mts
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { startTestServer, type TestServer } from "./harness.mts";

let db: PrismaClient;
let srv: TestServer;
let passed = 0, failed = 0;
const failures: string[] = [];
let baseUrl = "";
const tokens: Record<string, string> = {};
let centerId = "";
let stamp = "";

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(`${name}${extra ? " — " + extra : ""}`); console.log(`  ❌ ${name} ${extra}`); }
}

async function call(path: string, opts: { as?: string | null; method?: string; body?: unknown } = {}): Promise<Response> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const t = opts.as === undefined ? tokens.mgr : opts.as ? tokens[opts.as] : null;
  if (t) h["cookie"] = `nokhba_session=${t}`;
  return fetch(`${baseUrl}${path}`, { method: opts.method ?? "GET", headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function main(): Promise<void> {
  console.log("\n━━━ تشغيل السيرفر الاختباري المعزول ━━━");
  srv = await startTestServer();
  baseUrl = srv.baseUrl;
  db = new PrismaClient({ datasources: { db: { url: `file:${srv.dbFile}` } } });
  console.log(`✓ ${baseUrl}`);

  /* ─── بذر ─── */
  stamp = String(Date.now());
  const center = await db.center.create({ data: { name: "سنتر التحوينات", slug: `hard-${stamp}` } });
  centerId = center.id;
  const mgr = await db.user.create({ data: { username: `h-mgr-${stamp}`, passwordHash: "x", name: "مدير", role: "MANAGER", centerId, isActive: true } });
  const rec = await db.user.create({ data: { username: `h-rec-${stamp}`, passwordHash: "x", name: "استقبال", role: "RECEPTIONIST", centerId, isActive: true } });
  for (const [u, k] of [[mgr, "mgr"], [rec, "rec"]] as const) {
    const token = randomBytes(32).toString("hex");
    await db.authSession.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    tokens[k] = token;
  }
  const grade = await db.grade.create({ data: { centerId, name: "أولى ثانوي", order: 1 } });
  const subject = await db.subject.create({ data: { centerId, name: "فيزياء" } });

  /* ═══ المرحلة 8: لينكات واتساب ═══ */
  console.log("\n━━━ المرحلة 8: لينك جروب واتساب ━━━");
  const group = await db.group.create({
    data: { centerId, name: "A", gradeId: grade.id, subjectId: subject.id, sessionPrice: 6500, teacherPercent: 70 },
  });

  const bad1 = await call("/api/academics", { method: "PATCH", body: { type: "group", id: group.id, whatsapp: "javascript:alert(1)" } });
  check("لينك javascript: → مرفوض 400", bad1.status === 400);
  const bad2 = await call("/api/academics", { method: "PATCH", body: { type: "group", id: group.id, whatsapp: "http://chat.whatsapp.com/Abc123" } });
  check("http مش https → مرفوض 400", bad2.status === 400);
  const bad3 = await call("/api/academics", { method: "PATCH", body: { type: "group", id: group.id, whatsapp: "https://evil.example.com/invite" } });
  check("دومين غريب → مرفوض 400", bad3.status === 400);

  const good = await call("/api/academics", { method: "PATCH", body: { type: "group", id: group.id, whatsapp: "https://chat.whatsapp.com/AbC123_xZ-9" } });
  check("لينك دعوة رسمي → 200", good.status === 200, `status=${good.status}`);
  const list = await call("/api/academics").then((r) => r.json()) as { groups: { id: string; whatsapp: string | null }[] };
  check("اللينك ظاهر في GET", list.groups.find((g) => g.id === group.id)?.whatsapp === "https://chat.whatsapp.com/AbC123_xZ-9");

  const cleared = await call("/api/academics", { method: "PATCH", body: { type: "group", id: group.id, whatsapp: "" } });
  const list2 = await call("/api/academics").then((r) => r.json()) as { groups: { id: string; whatsapp: string | null }[] };
  check("فاضي → مسح اللينك (null)", cleared.status === 200 && list2.groups.find((g) => g.id === group.id)?.whatsapp === null);

  const created = await call("/api/academics", {
    method: "POST",
    body: { type: "group", name: "B", gradeId: grade.id, subjectId: subject.id, price: 65, teacherPercent: 70, whatsapp: "https://chat.whatsapp.com/NewGroup9" },
  });
  const createdBody = await created.json() as { group?: { id: string } };
  const g2 = createdBody.group?.id ? await db.group.findUnique({ where: { id: createdBody.group.id } }) : null;
  check("إنشاء مجموعة بلينك صالح → متخزنة", created.status === 201 && g2?.whatsappUrl === "https://chat.whatsapp.com/NewGroup9");

  /* ═══ المرحلة 6: التنبيهات الذكية ═══ */
  console.log("\n━━━ المرحلة 6: /api/alerts ━━━");
  const forbidden = await call("/api/alerts", { as: "rec" });
  check("موظف استقبال → مرفوض 403", forbidden.status === 403, `status=${forbidden.status}`);

  // بذر سيناريوهات كاملة قبل أول قراءة
  const debtor = await db.student.create({ data: { centerId, code: "81001", name: "طالب مدين", qrToken: `q-${stamp}-d`, status: "ACTIVE" } });
  await db.studentTransaction.create({ data: { centerId, studentId: debtor.id, type: "CHARGE", amount: -5000, createdBy: mgr.id } });
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  await db.cashDay.create({ data: { centerId, date: yesterday, openingCash: 0, status: "OPEN" } });
  await db.sessionInstance.create({
    data: { centerId, groupId: group.id, date: yesterday, startTime: "16:00", endTime: "18:00", price: 6500, teacherPercent: 70, status: "OPEN" },
  });
  await db.approvalRequest.create({
    data: {
      centerId, seq: 1, number: "AR-000001", type: "REFUND", status: "PENDING",
      payload: "{}", amount: 2500, reason: "اختبار تنبيه قديم", requestedBy: rec.id, requestedByName: "استقبال",
      createdAt: new Date(Date.now() - 2 * 86400_000),
    },
  });
  // غياب 3 حصص متتالية: طالب مسجل في المجموعة + آخر 3 حصص فاتت من غير حضور
  const streakStudent = await db.student.create({ data: { centerId, code: "81002", name: "طالب غايب", qrToken: `q-${stamp}-s`, status: "ACTIVE" } });
  await db.studentGroup.create({ data: { studentId: streakStudent.id, groupId: group.id, status: "ACTIVE" } });
  for (let i = 1; i <= 3; i++) {
    await db.sessionInstance.create({
      data: { centerId, groupId: group.id, date: new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), startTime: "16:00", endTime: "18:00", price: 6500, teacherPercent: 70, status: "CLOSED" },
    });
  }

  const res = await call("/api/alerts");
  const body = await res.json() as { alerts: { key: string; severity: string; count: number }[] };
  check("المدير → 200", res.status === 200, `status=${res.status}`);
  const byKey = new Map(body.alerts.map((a) => [a.key, a]));
  check("تنبيه المديونية ظاهر CRITICAL", byKey.get("NEGATIVE_BALANCES")?.severity === "CRITICAL" && byKey.get("NEGATIVE_BALANCES")?.count === 1);
  check("تنبيه يوم الخزنة المفتوح ظاهر", byKey.has("OPEN_CASH_DAYS"));
  check("تنبيه حصة قديمة مش مقفولة ظاهر", byKey.has("OPEN_PAST_SESSIONS") && byKey.get("OPEN_PAST_SESSIONS")?.count === 1);
  check("تنبيه طلب موافقة قديم ظاهر", byKey.has("STALE_APPROVALS"));
  check("تنبيه الغياب المتكرر ظاهر (فاتته آخر 3)", byKey.has("ABSENCE_STREAKS") && byKey.get("ABSENCE_STREAKS")?.count === 1);
  check("مفيش تنبيه احتياطي في وضع SQLite", !byKey.has("BACKUP_STALE"));

  /* ═══ cron اليومي: dedupe ═══ */
  console.log("\n━━━ cron /api/alerts/cron ━━━");
  const c1 = await call("/api/alerts/cron", { as: null });
  const c1Body = await c1.json() as { ok: boolean; pushed: number };
  check("cron بدون سر → شغال (CRON_SECRET مش متعرّف)", c1.status === 200 && c1Body.ok === true, `status=${c1.status}`);
  check("اتبعث إشعار واحد على الأقل", c1Body.pushed >= 1, `pushed=${c1Body.pushed}`);
  const notifCount = await db.staffNotification.count({ where: { centerId, type: "SYSTEM", refId: `daily-alerts-${new Date().toISOString().slice(0, 10)}` } });
  check("إشعار واحد للمدير بالظبط", notifCount === 1, `count=${notifCount}`);
  const c2 = await call("/api/alerts/cron", { as: null });
  const c2Body = await c2.json() as { pushed: number };
  check("تاني في نفس اليوم → صفر إضافي (dedupe)", c2.status === 200 && c2Body.pushed === 0, `pushed=${c2Body.pushed}`);

  /* ─── النتيجة ─── */
  console.log(`\n━━━ النتيجة: ${passed} ناجح / ${failed} فاشل ━━━`);
  if (failed > 0) { console.log(failures.map((f) => `  • ${f}`).join("\n")); }
  await db.$disconnect();
  await srv.stop();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("💥 فشل تشغيل الاختبار:", e);
  try { await db?.$disconnect(); await srv?.stop(); } catch { /* تجاهل */ }
  process.exit(1);
});
