/**
 * اختبار مصفوفة الأدوار لتصدير البيانات بالجملة — spec المرحلة 1.
 * ------------------------------------------------------------
 * القاعدة: التصدير بالجملة للأدمن العام فقط. المدير/الاستقبال/المدرس/زائر = رفض.
 * بيشتغل على سيرفر معزول (harness) بقاعدة SQLite مؤقتة — صفر لمس لأي بيانات حقيقية.
 * التشغيل: npm run build ثم npx tsx scripts/tests/export-role-matrix.mts
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { startTestServer, type TestServer } from "./harness.mts";

let db: PrismaClient;
let srv: TestServer;
let passed = 0, failed = 0;
const failures: string[] = [];

type Role = "ADMIN" | "MANAGER" | "RECEPTIONIST" | "TEACHER";
const tokens: Record<string, string> = {}; // key: admin|mgrA|recA|tchA|mgrB

function cookie(name: string): string | null {
  return tokens[name] ? `nokhba_session=${tokens[name]}` : null;
}

async function call(path: string, opts: { as?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const h: Record<string, string> = { ...(opts.headers ?? {}) };
  const c = opts.as === undefined ? cookie("mgrA") : opts.as ? cookie(opts.as) : null;
  if (c) h["cookie"] = h["cookie"] ? `${h["cookie"]}; ${c}` : c;
  const init: RequestInit = { method: opts.method ?? "GET", headers: h };
  if (opts.body !== undefined) { h["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(`${srv.baseUrl}${path}`, init);
}

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  ❌ ${name} ${extra}`); }
}

async function statusOf(res: Response): Promise<number> { return res.status; }

async function main(): Promise<void> {
  console.log("\n━━━ تشغيل السيرفر الاختباري المعزول ━━━");
  srv = await startTestServer();
  db = new PrismaClient({ datasources: { db: { url: `file:${srv.dbFile}` } } });
  console.log(`✓ سيرفر معزول: ${srv.baseUrl}`);

  /* ─── بذر بيانات اختبار (سنترين + كل الأدوار + حصة مقفولة بحضور) ─── */
  const centerA = await db.center.create({ data: { name: "سنتر اختبار أ", slug: `test-a-${Date.now()}` } });
  const centerB = await db.center.create({ data: { name: "سنتر اختبار ب", slug: `test-b-${Date.now()}` } });

  const mkUser = async (username: string, name: string, role: string, centerId: string | null) =>
    db.user.create({ data: { username, passwordHash: "x-test-not-a-login", name, role, centerId, isActive: true } });
  const admin = await mkUser(`t-admin-${Date.now()}`, "أدمن المنصة", "ADMIN", null);
  const mgrA = await mkUser(`t-mgr-a-${Date.now()}`, "مدير أ", "MANAGER", centerA.id);
  const recA = await mkUser(`t-rec-a-${Date.now()}`, "استقبال أ", "RECEPTIONIST", centerA.id);
  const tchA = await mkUser(`t-tch-a-${Date.now()}`, "مدرس أ", "TEACHER", centerA.id);
  const mgrB = await mkUser(`t-mgr-b-${Date.now()}`, "مدير ب", "MANAGER", centerB.id);

  const mkSession = async (u: { id: string }, label: string) => {
    const token = randomBytes(32).toString("hex");
    await db.authSession.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    tokens[label] = token;
  };
  await mkSession(admin, "admin"); await mkSession(mgrA, "mgrA"); await mkSession(recA, "recA");
  await mkSession(tchA, "tchA"); await mkSession(mgrB, "mgrB");

  const grade = await db.grade.create({ data: { centerId: centerA.id, name: "الثالث الثانوي" } });
  const subject = await db.subject.create({ data: { centerId: centerA.id, name: "فيزياء" } });
  const group = await db.group.create({ data: { centerId: centerA.id, gradeId: grade.id, subjectId: subject.id, name: "أ", sessionPrice: 5000 } });
  const mkStudent = (code: string, name: string) => ({ centerId: centerA.id, code, name, status: "ACTIVE", qrToken: randomBytes(24).toString("hex") });
  const s1 = await db.student.create({ data: mkStudent("90001", "طالب اختبار ١") });
  const s2 = await db.student.create({ data: mkStudent("90002", "طالب اختبار ٢") });
  const today = new Date().toISOString().slice(0, 10);
  const sessionA = await db.sessionInstance.create({
    data: { centerId: centerA.id, groupId: group.id, date: today, startTime: "16:00", endTime: "18:00", price: 5000, teacherPercent: 50, status: "CLOSED", presentCount: 2 },
  });
  await db.attendance.create({ data: { centerId: centerA.id, sessionId: sessionA.id, studentId: s1.id, status: "PRESENT", studentName: s1.name, studentCode: s1.code, method: "MANUAL" } });
  await db.attendance.create({ data: { centerId: centerA.id, sessionId: sessionA.id, studentId: s2.id, status: "LATE", studentName: s2.name, studentCode: s2.code, method: "MANUAL" } });
  // حصة مقفولة في السنتر ب (لاختبار النطاق بين السنترات)
  const gradeB = await db.grade.create({ data: { centerId: centerB.id, name: "الأول الثانوي" } });
  const subjB = await db.subject.create({ data: { centerId: centerB.id, name: "كيمياء" } });
  const groupB = await db.group.create({ data: { centerId: centerB.id, gradeId: gradeB.id, subjectId: subjB.id, name: "ب", sessionPrice: 4000 } });
  const sessionB = await db.sessionInstance.create({
    data: { centerId: centerB.id, groupId: groupB.id, date: today, startTime: "17:00", endTime: "19:00", price: 4000, teacherPercent: 50, status: "CLOSED" },
  });

  /* ─── المصفوفة ─── */
  console.log("\n━━━ 1) CSV حضور الحصة — /api/sessions/[id]/export ━━━");
  check("أدمن → 200", (await call(`/api/sessions/${sessionA.id}/export`, { as: "admin" })).status === 200);
  check("مدير أ → 403", (await call(`/api/sessions/${sessionA.id}/export`, { as: "mgrA" })).status === 403);
  check("استقبال → 403", (await call(`/api/sessions/${sessionA.id}/export`, { as: "recA" })).status === 403);
  check("مدرس → 403", (await call(`/api/sessions/${sessionA.id}/export`, { as: "tchA" })).status === 403);
  check("زائر → 401", (await call(`/api/sessions/${sessionA.id}/export`, { as: null })).status === 401);
  check("أدمن — حصة سنتر ب (نطاق من الداتابيز) → 200", (await call(`/api/sessions/${sessionB.id}/export`, { as: "admin" })).status === 200);
  check("مدير ب — حصة سنتر أ → 403 (عزل)", (await call(`/api/sessions/${sessionA.id}/export`, { as: "mgrB" })).status === 403);

  console.log("\n━━━ 2) تقارير CSV — /api/reports?export=csv ━━━");
  check("أدمن + centerId → 200", (await call(`/api/reports?type=daily&export=csv&centerId=${centerA.id}`, { as: "admin" })).status === 200);
  check("أدمن بدون centerId → 400", (await call("/api/reports?type=daily&export=csv", { as: "admin" })).status === 400);
  check("مدير أ → 403", (await call(`/api/reports?type=daily&export=csv&centerId=${centerA.id}`, { as: "mgrA" })).status === 403);
  check("استقبال → 403", (await call(`/api/reports?type=daily&export=csv`, { as: "recA" })).status === 403);
  check("مدرس → 403", (await call(`/api/reports?type=daily&export=csv`, { as: "tchA" })).status === 403);
  check("مدير أ يحاول centerId=ب → 403 (سرقة نطاق)", (await call(`/api/reports?type=daily&export=csv&centerId=${centerB.id}`, { as: "mgrA" })).status === 403);
  // المشاهدة على الشاشة زي ما هي — لطاقم السنتر بصلاحية
  check("مشاهدة JSON: مدير أ → 200 (غير متأثرة)", (await call(`/api/reports?type=daily`, { as: "mgrA" })).status === 200);

  console.log("\n━━━ 3) نسخ احتياطي JSON/CSV — /api/backup ━━━");
  check("أدمن JSON + centerId → 200", (await call(`/api/backup?format=json&centerId=${centerA.id}`, { as: "admin" })).status === 200);
  check("أدمن CSV + centerId → 200", (await call(`/api/backup?format=csv&table=students&centerId=${centerA.id}`, { as: "admin" })).status === 200);
  check("أدمن JSON بدون centerId → 400", (await call("/api/backup?format=json", { as: "admin" })).status === 400);
  check("مدير أ JSON → 403", (await call(`/api/backup?format=json&centerId=${centerA.id}`, { as: "mgrA" })).status === 403);
  check("مدير ب JSON سنتر أ → 403", (await call(`/api/backup?format=json&centerId=${centerA.id}`, { as: "mgrB" })).status === 403);
  check("مدرس CSV → 403", (await call(`/api/backup?format=csv&table=students&centerId=${centerA.id}`, { as: "tchA" })).status === 403);
  check("حالة النسخ: أدمن → 200", (await call("/api/backup", { as: "admin" })).status === 200);
  check("حالة النسخ: مدير → 403", (await call("/api/backup", { as: "mgrA" })).status === 403);
  check("تنزيل .db فيزيائي: مدير → 403", (await call("/api/backup?download=latest", { as: "mgrA" })).status === 403);

  console.log("\n━━━ 4) حزم الطوارئ — /api/emergency ━━━");
  check("أدمن حزمة HTML + centerId → 200", (await call(`/api/emergency?package=1&centerId=${centerA.id}`, { as: "admin" })).status === 200);
  check("أدمن إكسل + centerId → 200", (await call(`/api/emergency?package=1&format=xlsx&centerId=${centerA.id}`, { as: "admin" })).status === 200);
  check("أدمن بدون centerId → 400", (await call("/api/emergency?package=1", { as: "admin" })).status === 400);
  check("مدير أ حزمة → 403", (await call(`/api/emergency?package=1&centerId=${centerA.id}`, { as: "mgrA" })).status === 403);
  check("مدرس حزمة → 403", (await call(`/api/emergency?package=1&centerId=${centerA.id}`, { as: "tchA" })).status === 403);
  check("سجل المزامنات: مدير أ → 200 (الاستيراد محفوظ)", (await call("/api/emergency", { as: "mgrA" })).status === 200);
  check("سجل المزامنات: مدرس → 403", (await call("/api/emergency", { as: "tchA" })).status === 403);
  // الاستيراد (recovery) صلاحيته مستقلة — المدير بيوصل للـ POST (نأكد إن الرفض مش بسبب الدور)
  const recPost = await call("/api/emergency", { as: "mgrA", method: "POST", body: { action: "recovery-preview" } });
  check("استرداد: مدير أ POST → مش 403 دور (بل تحقق مدخلات)", recPost.status !== 403, `status=${recPost.status}`);
  check("استرداد: مدرس POST → 403", (await call("/api/emergency", { as: "tchA", method: "POST", body: { action: "recovery-preview" } })).status === 403);

  console.log("\n━━━ 5) كروت الطلاب — /api/students/[id]/card ━━━");
  check("كارت واحد: مدير أ → 200 (استخدام فردي محفوظ)", (await call(`/api/students/${s1.id}/card`, { as: "mgrA" })).status === 200);
  const bulkMgr = await call(`/api/students/${s1.id}/card?centerId=${centerA.id}`, { as: "mgrA", method: "POST", body: { ids: [s1.id, s2.id] } });
  check("كروت بالجملة: مدير أ → 403", bulkMgr.status === 403);
  const bulkAdmin = await call(`/api/students/${s1.id}/card?centerId=${centerA.id}`, { as: "admin", method: "POST", body: { ids: [s1.id, s2.id] } });
  check("كروت بالجملة: أدمن → 200", bulkAdmin.status === 200);
  const bulkAdminNoCenter = await call(`/api/students/${s1.id}/card`, { as: "admin", method: "POST", body: { ids: [s1.id] } });
  check("كروت بالجملة: أدمن بدون centerId → 400", bulkAdminNoCenter.status === 400);
  check("كروت بالجملة: استقبال → 403", (await call(`/api/students/${s1.id}/card?centerId=${centerA.id}`, { as: "recA", method: "POST", body: { ids: [s1.id] } })).status === 403);

  console.log("\n━━━ 6) محاولات تزوير الدور (spoofing) ━━━");
  const spoofHeaders = { "x-role": "ADMIN", "x-user-role": "ADMIN" };
  check("مدير + ?role=ADMIN + هيدرات → 403 (CSV حضور)", (await call(`/api/sessions/${sessionA.id}/export?role=ADMIN`, { as: "mgrA", headers: spoofHeaders })).status === 403);
  check("مدير + role في البودي → 403 (كروت بالجملة)", (await call(`/api/students/${s1.id}/card?centerId=${centerA.id}`, { as: "mgrA", method: "POST", body: { ids: [s1.id], role: "ADMIN" }, headers: spoofHeaders })).status === 403);
  check("مدير + cookie مزدوجة مزوّرة → 403", (await call(`/api/reports?type=daily&export=csv&centerId=${centerA.id}`, { as: "mgrA", headers: { cookie: "nokhba_session=forged-token; role=ADMIN" } })).status === 403);
  check("مدير + ?centerId=سنتر تاني + تزوير → 403", (await call(`/api/backup?format=json&centerId=${centerB.id}&role=ADMIN`, { as: "mgrA", headers: spoofHeaders })).status === 403);

  console.log("\n━━━ 7) التدقيق — EXPORT_DENIED اتسجل ━━━");
  const denies = await db.auditLog.count({ where: { action: "رفض محاولة تصدير بيانات", userId: mgrA.id } });
  check(`صفوف رفض للمدير مسجلة (${denies} ≥ 5)`, denies >= 5);
  const allowed = await db.auditLog.count({ where: { action: "تصدير كشف حضور CSV" } });
  check(`تصدير الحضور المسموح مسجل (${allowed} ≥ 2)`, allowed >= 2);

  /* ─── الخلاصة ─── */
  console.log(`\n━━━ النتيجة: ${passed} ناجح / ${failed} فاشل ━━━`);
  if (failures.length) { console.log("الفاشلة:"); failures.forEach((f) => console.log("  - " + f)); }
  await db.$disconnect();
  await srv.stop();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("💥 فشل تشغيل الاختبار:", e);
  try { await db?.$disconnect(); } catch {}
  try { await srv?.stop(); } catch {}
  process.exit(1);
});
