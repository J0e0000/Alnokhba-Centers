/**
 * اختبار السعة: 10,000 طالب في سنتر مؤقت (بدون لمس بيانات الإنتاج):
 * 1. إدخال 10K طالب (createMany بدفعات) + قياس الزمن
 * 2. قائمة الطلاب صفحة 1 (باجنيشن سيرفري) + البحث بالاسم/الكود/التليفون
 * 3. lookup اللايف (البحث أثناء الكتابة)
 * 4. مسح حضور بكود 5 أرقام (exact match)
 * 5. عدّ الطلاب للفوترة (pricing على 10K)
 * 6. التنضيف الكامل بعد الاختبار
 */
import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";

const BASE = "http://localhost:3000";
let cookie = "";

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  console.log("=== اختبار السعة: 10,000 طالب ===\n");
  let r = await api("/api/auth", { method: "POST", body: { username: "admin", password: "nokhba123" } });
  if (r.status !== 200) { console.error("فشل دخول الأدمن"); process.exit(1); }

  // نتحقق من دخول أدمن — الأدمن ملوش centerId، فنشغل الاختبار عبر Prisma مباشرة للبيانات
  // والداتا اللي محتاجة سيرفر (lookup/scan) نعملها بجلسة المدير بعد إضافة سنتر الاختبار له... 
  // الأبسط: نستخدم جلسة manager لكن كل استعلامات الطلاب scoped بـ centerId — فلازم سنتر الاختبار
  // يبقى هو سنتر المدير... مينفعش. الحل: نعمل API calls بحساب جديد في سنتر الاختبار.

  const db = new PrismaClient();
  const crypto = await import("crypto");

  // 1) سنتر اختبار + مستخدم
  const stamp = Date.now().toString(36);
  const center = await db.center.create({
    data: { name: `سنتر اختبار السعة ${stamp}`, slug: `cap-${stamp}`, status: "ACTIVE" },
  });
  const password = "cap-test-123";
  // نفس hashing المستخدم (scrypt)
  const { scryptSync, randomBytes } = crypto;
  const salt = randomBytes(16).toString("hex");
  const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const user = await db.user.create({
    data: { centerId: center.id, username: `capmgr-${stamp}`, passwordHash: hash, name: "مدير السعة", role: "MANAGER" },
  });
  // مرحلة + مجموعة + قاعة للتسجيل والحصص
  const grade = await db.grade.create({ data: { centerId: center.id, name: "الأول الثانوي", order: 1 } });
  const subject = await db.subject.create({ data: { centerId: center.id, name: "رياضة" } });
  const teacher = await db.teacher.create({ data: { centerId: center.id, name: "مدرس السعة" } });
  const group = await db.group.create({
    data: { centerId: center.id, name: "A", gradeId: grade.id, subjectId: subject.id, teacherId: teacher.id, sessionPrice: 10000 },
  });
  // 10,000 طالب على 5 مدارات أكواد (10000-19999)
  console.log("إدخال 10,000 طالب...");
  const t0 = Date.now();
  const BATCH = 1000;
  let totalStudents = 0;
  for (let base = 0; base < 10000; base += BATCH) {
    const rows = Array.from({ length: BATCH }, (_, i) => {
      const n = base + i;
      return {
        centerId: center.id,
        code: String(10000 + n),
        qrToken: crypto.randomBytes(24).toString("hex") + n,
        name: `طالب اختبار ${n} محمد علي`,
        phone: `0100000${String(1000 + (n % 9000)).slice(0, 4)}`,
        parentName: `ولي أمر ${n}`,
        parentPhone: `0110000${String(1000 + (n % 9000)).slice(0, 4)}`,
        gradeId: grade.id,
        status: "ACTIVE",
      };
    });
    await db.student.createMany({ data: rows });
    totalStudents += BATCH;
  }
  const insertMs = Date.now() - t0;
  console.log(`✓ اتسجل ${totalStudents.toLocaleString("en-US")} طالب في ${(insertMs / 1000).toFixed(1)} ثانية`);

  // تسجيل أول 5000 في المجموعة (باجنيشن اختيار الدفع)
  const tReg = Date.now();
  const first5k = await db.student.findMany({ where: { centerId: center.id }, take: 5000, select: { id: true } });
  await db.studentGroup.createMany({
    data: first5k.map((s) => ({ studentId: s.id, groupId: group.id, registeredBy: user.id })),
  });
  console.log(`✓ تسجيل 5,000 طالب في مجموعة في ${((Date.now() - tReg) / 1000).toFixed(1)} ثانية`);

  // جلسة المدير بتاع سنتر الاختبار
  r = await api("/api/auth", { method: "POST", body: { username: `capmgr-${stamp}`, password } });
  if (r.status !== 200) { console.error("فشل دخول مدير السعة", r.data); process.exit(1); }

  const results: [string, number, boolean][] = [];
  async function timed(name: string, fn: () => Promise<unknown>, budgetMs = 1500) {
    const t = Date.now();
    const out = await fn();
    const ms = Date.now() - t;
    const ok = ms < budgetMs;
    results.push([name, ms, ok]);
    console.log(`  ${ok ? "✓" : "✗"} ${name}: ${ms}ms (الميزانية ${budgetMs}ms)`);
    return out;
  }

  console.log("\n--- استعلامات السيرفر على 10K طالب ---");

  // 2) قائمة الطلاب صفحة 1
  const page1 = await timed("قائمة الطلاب صفحة 1 (24/صفحة)", () => api("/api/students"));
  const listOk = page1.status === 200 && page1.data.total === 10000 && page1.data.students.length === 24;
  console.log(`    total=${page1.data.total} صف=${page1.data.students?.length} — ${listOk ? "سليم" : "مش سليم!"}`);

  // صفحة عميقة (صفحة 400)
  await timed("صفحة عميقة (صفحة 400)", () => api("/api/students?page=400"));

  // 3) بحث سيرفري: اسم / كود / تليفون
  await timed("بحث بالاسم (contains)", () => api("/api/students?q=" + encodeURIComponent("طالب اختبار 9999")));
  await timed("بحث بالكود (5000)", () => api("/api/students?q=15000"));
  await timed("بحث بالتليفون", () => api("/api/students?q=0110000"));

  // lookup اللايف (max 8 نتائج)
  const lookup = await timed("lookup لايف (بحث أثناء الكتابة)", () => api("/api/lookup?q=" + encodeURIComponent("طالب اختبار 5")), 800);
  console.log(`    نتائج lookup: ${(lookup.data.students ?? []).length} (المفروض ≤ 8)`);

  // 4) مسح حضور بكود (exact) — نفتح حصة الأول
  const today = new Date().toISOString().slice(0, 10);
  const sess = await db.sessionInstance.create({
    data: { centerId: center.id, groupId: group.id, date: today, startTime: "09:00", endTime: "11:00", price: 10000, teacherPercent: 50, status: "OPEN", openedBy: user.id },
  });
  const scan = await timed("مسح حضور بكود 5 أرقام (exact)", () =>
    api("/api/attendance/scan", { method: "POST", body: { query: "15000", sessionId: sess.id } }), 2000);
  const scanOk = scan.data.status === "GREEN" && scan.data.student?.code === "15000";
  console.log(`    النتيجة: ${scan.data.status} — ${scan.data.student?.name ?? "?"} ${scanOk ? "✓" : "✗"}`);

  // QR token مسح (exact)
  const qrStudent = await db.student.findFirst({ where: { centerId: center.id, code: "15001" } });
  const qrScan = await timed("مسح حضور بـ QR token (exact)", () =>
    api("/api/attendance/scan", { method: "POST", body: { query: qrStudent!.qrToken, sessionId: sess.id } }), 2000);
  console.log(`    النتيجة: ${qrScan.data.status} — ${qrScan.data.student?.code ?? "?"}`);

  // 5) dashboard KPIs على 10K
  await timed("لوحة التحكم (KPIs مجمّعة)", () => api("/api/dashboard"), 3000);

  // 6) التنضيف الكامل
  console.log("\n--- التنضيف ---");
  const tClean = Date.now();
  await db.attendance.deleteMany({ where: { centerId: center.id } });
  await db.studentTransaction.deleteMany({ where: { centerId: center.id } });
  await db.studentGroup.deleteMany({ where: { group: { centerId: center.id } } });
  await db.student.deleteMany({ where: { centerId: center.id } });
  await db.sessionInstance.deleteMany({ where: { centerId: center.id } });
  await db.group.deleteMany({ where: { centerId: center.id } });
  await db.subject.deleteMany({ where: { centerId: center.id } });
  await db.grade.deleteMany({ where: { centerId: center.id } });
  await db.teacher.deleteMany({ where: { centerId: center.id } });
  await db.authSession.deleteMany({ where: { user: { centerId: center.id } } });
  await db.user.deleteMany({ where: { centerId: center.id } });
  await db.center.delete({ where: { id: center.id } });
  console.log(`✓ اتنضف كل شيء في ${((Date.now() - tClean) / 1000).toFixed(1)} ثانية`);

  const failed = results.filter(([, ms, ok]) => !ok);
  console.log("\n========================================");
  console.log(`اختبار السعة: ${results.length - failed.length}/${results.length} استعلام ضمن الميزانية`);
  if (failed.length) {
    console.log("اللي عدّى الميزانية:");
    failed.forEach(([n, ms]) => console.log(`  ✗ ${n}: ${ms}ms`));
  }
  await db.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error("خطأ:", e); process.exit(1); });
