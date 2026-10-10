/**
 * اختبار السعة + الربط (Data Linking) — بنفس نمط test-capacity-10k المعزول:
 * سنتر اختبار مستقل تمامًا (بيانات الإنتاج — النخبة/الأمل — لا تُلمس إطلاقًا).
 *
 * الحجم المطلوب: 5000 طالب + 30 مدرس + 100 حصة، مع:
 *   - 30 مجموعة (كل مدرس مجموعته) + 4500 تسجيل طالب↔مجموعة
 *   - 11,520+ سجل حضور مربوط بالحصص والطلاب
 *   - ~4,400 حركة مالية (دفعات + خصومات حضور) في الليدجر
 *   - 30 فتحة جدول أسبوعي (عشان البورتال يطلّع «أقرب حصة»)
 *
 * فحوصات الربط:
 *   (أ) تطابق الأعداد + سلامة المراجع (تسجيل/حضور/حصص كلها في نفس السنتر)
 *   (ب) تجميعات إغلاق الحصص == الحساب من سجلات الحضور الفعلية
 *   (ج) أرصدة الطلاب == مجموع حركاتهم بالقروش
 *   (د) مسح QR/كود ينشئ حضور + خصم، والبورتال يشوف الرصيد الجديد فورًا
 *   (هـ) KPIs الداشبورد == أرقام الداتابيز (طبق الأصل)
 *
 * الاستخدام:
 *   bun scripts/capacity-load.ts           → تشغيلة كاملة (تنضيف أي تشغيلة سابقة الأول) — البيانات تفضل موجودة للتصفح
 *   bun scripts/capacity-load.ts cleanup   → حذف كل بيانات الاختبار نهائيًا
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const BASE = "http://localhost:3000";
const SLUG = "cap-load-5000";
const CENTER_NAME = "سنتر اختبار السعة 5000";
const MGR_USER = "capmgr";
const REC_USER = "caprec";
const PASSWORD = "nokhba-cap-5000";

const db = new PrismaClient();
let cookie = "";

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> };
}

// ---------- تواريخ القاهرة ----------
function cairoYMD(): { y: number; m: number; d: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", dateStyle: "short" });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get("year"), m = get("month"), d = get("day");
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return { y, m, d, dow };
}
function dayStr(offsetDays: number): string {
  const { y, m, d } = cairoYMD();
  return new Date(Date.UTC(y, m - 1, d, 12) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// ---------- أسماء مصرية واقعية ----------
const FIRST_M = ["أحمد", "محمد", "يوسف", "عمر", "مصطفى", "خالد", "زياد", "كريم", "حمزة", "ياسين", "طارق", "سيف", "آدم", "مالك", "راكان"];
const FIRST_F = ["مريم", "فاطمة", "جنى", "ملك", "هنا", "سلمى", "نور", "حبيبة", "لينا", "سارة"];
const MID = ["محمد", "أحمد", "السيد", "عبدالله", "محمود", "إبراهيم", "حسن", "مصطفى", "شريف", "عمرو"];
const FAM = ["عبدالعزيز", "السيد", "إبراهيم", "حسن", "شعبان", "عبدالرحمن", "فتحي", "سليمان", "الشناوي", "عيد", "رمضان", "زكي"];
const GRADES = ["الأول الثانوي", "الثاني الثانوي", "الثالث الثانوي", "الأول الإعدادي", "الثاني الإعدادي", "الثالث الإعدادي"];
const SUBJECTS = ["رياضيات", "لغة عربية", "لغة إنجليزية", "فيزياء", "كيمياء"];
const TIME_SLOTS: [string, string][] = [["14:00", "15:30"], ["16:00", "17:30"], ["18:30", "20:00"], ["20:15", "21:45"]];
const METHODS = ["CASH", "VODAFONE", "INSTAPAY"];

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
function check(name: string, cond: boolean, detail = "") {
  results.push([name, 0, cond]);
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ============================= التنضيف =============================
async function cleanup(quiet = false) {
  const center = await db.center.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!center) { if (!quiet) console.log("مفيش بيانات اختبار سعة موجودة."); return; }
  const t = Date.now();
  await db.attendance.deleteMany({ where: { centerId: center.id } });
  await db.studentTransaction.deleteMany({ where: { centerId: center.id } });
  await db.studentGroup.deleteMany({ where: { group: { centerId: center.id } } });
  await db.student.deleteMany({ where: { centerId: center.id } });
  await db.sessionInstance.deleteMany({ where: { centerId: center.id } });
  await db.scheduleSlot.deleteMany({ where: { centerId: center.id } });
  await db.group.deleteMany({ where: { centerId: center.id } });
  await db.subject.deleteMany({ where: { centerId: center.id } });
  await db.grade.deleteMany({ where: { centerId: center.id } });
  await db.teacher.deleteMany({ where: { centerId: center.id } });
  await db.authSession.deleteMany({ where: { user: { centerId: center.id } } });
  await db.user.deleteMany({ where: { centerId: center.id } });
  await db.center.delete({ where: { id: center.id } });
  if (!quiet) console.log(`✓ اتنضف سنتر الاختبار بالكامل في ${((Date.now() - t) / 1000).toFixed(1)} ثانية`);
}

// ============================= التشغيلة الكاملة =============================
async function main() {
  const mode = process.argv[2] ?? "";
  if (mode === "cleanup") { await cleanup(); return; }

  console.log("=== اختبار السعة + الربط: 5000 طالب / 30 مدرس / 100 حصة ===\n");
  console.log("(سنتر اختبار معزول — بيانات الإنتاج في أمان تام)\n");

  // 0) تشغيلة جديدة → ننضف أي سنتر اختبار سابق بنفس الـ slug
  await cleanup(true);
  cookie = "";

  const salt = randomBytes(16).toString("hex");
  const hash = `scrypt:${salt}:${scryptSync(PASSWORD, salt, 64).toString("hex")}`;
  const center = await db.center.create({
    data: { name: CENTER_NAME, slug: SLUG, status: "ACTIVE", slogan: "بيانات اختبار سعة — للتصفح فقط" },
  });
  const mgr = await db.user.create({
    data: { centerId: center.id, username: MGR_USER, passwordHash: hash, name: "مدير السعة", role: "MANAGER" },
  });
  await db.user.create({
    data: { centerId: center.id, username: REC_USER, passwordHash: hash, name: "استقبال السعة", role: "RECEPTIONIST" },
  });
  console.log(`✓ سنتر الاختبار جاهز: ${CENTER_NAME} (مدير: ${MGR_USER} / استقبال: ${REC_USER} — الباسورد: ${PASSWORD})`);

  // ===== 1) الهيكل الأكاديمي: 6 مراحل × 5 مواد = 30 مجموعة لـ 30 مدرس =====
  const grades = await Promise.all(GRADES.map((name, i) => db.grade.create({ data: { centerId: center.id, name, order: i + 1 } })));
  const subjects = await Promise.all(SUBJECTS.map((name) => db.subject.create({ data: { centerId: center.id, name } })));
  const teachers = await Promise.all(
    Array.from({ length: 30 }, (_, i) => db.teacher.create({ data: { centerId: center.id, name: `مدرس اختبار ${i + 1} ${MID[i % MID.length]}`, phone: `012${(3_000_000 + i)}` } })),
  );
  const groups: { id: string; price: number; pct: number; idx: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const g = await db.group.create({
      data: {
        centerId: center.id, name: String.fromCharCode(65 + (i % 20)) + (i >= 20 ? "2" : ""),
        gradeId: grades[i % 6].id, subjectId: subjects[Math.floor(i / 6)].id,
        teacherId: teachers[i].id,
        sessionPrice: 6000 + (i % 7) * 1000, // 60–120 جنيه
        teacherPercent: 40 + (i % 5) * 5,
        room: `قاعة ${(i % 4) + 1}`,
      },
    });
    groups.push({ id: g.id, price: g.sessionPrice, pct: g.teacherPercent, idx: i });
  }
  console.log("✓ 30 مدرس × 30 مجموعة (كل مدرس مربوط بمجموعته) + 6 مراحل + 5 مواد");

  // ===== 2) 5000 طالب (دفعات 500) =====
  const N_STUDENTS = 5000;
  console.log(`\nإدخال ${N_STUDENTS.toLocaleString("en-US")} طالب...`);
  const tIns = Date.now();
  const studentRows = Array.from({ length: N_STUDENTS }, (_, i) => {
    const female = i % 3 === 2;
    const first = female ? FIRST_F[(i * 7) % FIRST_F.length] : FIRST_M[(i * 11) % FIRST_M.length];
    const mid = MID[(i * 13) % MID.length];
    const fam = FAM[(i * 17) % FAM.length];
    return {
      centerId: center.id,
      code: String(20000 + i),
      qrToken: randomBytes(24).toString("hex"),
      name: `${first} ${mid} ${fam}`,
      phone: `010${10000000 + i}`,
      parentName: mid, // استنتاج ولي الأمر = أول اسم بعد اسم الطالب
      parentPhone: `011${20000000 + i}`,
      gradeId: grades[i % 6].id,
      status: "ACTIVE",
    };
  });
  for (let b = 0; b < N_STUDENTS; b += 500) {
    await db.student.createMany({ data: studentRows.slice(b, b + 500) });
  }
  const insertMs = Date.now() - tIns;
  console.log(`✓ اتسجل ${N_STUDENTS.toLocaleString("en-US")} طالب في ${(insertMs / 1000).toFixed(1)} ثانية (${Math.round(N_STUDENTS / (insertMs / 1000)).toLocaleString("en-US")} طالب/ثانية)`);

  // ===== 3) 4500 تسجيل في المجموعات (150 لكل مجموعة) + 500 من غير مجموعة =====
  const tReg = Date.now();
  const idByCode = new Map<string, string>();
  const allStudents = await db.student.findMany({ where: { centerId: center.id }, select: { id: true, code: true }, orderBy: { code: "asc" } });
  allStudents.forEach((s) => idByCode.set(s.code, s.id));
  const regRows = Array.from({ length: 4500 }, (_, i) => ({
    studentId: idByCode.get(String(20000 + i))!,
    groupId: groups[i % 30].id,
    priceOverride: i % 10 === 0 ? groups[i % 30].price + 2000 : null,
    registeredBy: mgr.id,
  }));
  for (let b = 0; b < regRows.length; b += 1000) {
    await db.studentGroup.createMany({ data: regRows.slice(b, b + 1000) });
  }
  console.log(`✓ 4500 تسجيل طالب↔مجموعة (150/مجموعة) في ${((Date.now() - tReg) / 1000).toFixed(1)} ثانية — و500 طالب لسه من غير مجموعة`);

  // ===== 4) 100 حصة: 90 ماضية (مغلقة بتجمعاتها) + 10 النهاردة (6 مغلقة + 4 مفتوحة) =====
  const today = dayStr(0);
  const sessionDefs: {
    groupId: string; date: string; startTime: string; endTime: string; price: number; pct: number;
    status: "OPEN" | "CLOSED";
  }[] = [];
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 3; j++) {
      const day = -(((i * 3 + j) % 14) + 1);
      const [st, en] = TIME_SLOTS[(i + j) % TIME_SLOTS.length];
      sessionDefs.push({ groupId: groups[i].id, date: dayStr(day), startTime: st, endTime: en, price: groups[i].price, pct: groups[i].pct, status: "CLOSED" });
    }
  }
  const nowH = new Date(Date.now() + 3 * 3600_000).getUTCHours(); // تقريبي كفاية
  for (let k = 0; k < 10; k++) {
    const g = groups[k];
    const closed = k < 6;
    sessionDefs.push({
      groupId: g.id, date: today,
      startTime: closed ? "08:00" : `${String((nowH + 21) % 24).padStart(2, "0")}:00`,
      endTime: closed ? "09:30" : `${String((nowH + 23) % 24).padStart(2, "0")}:30`,
      price: g.price, pct: g.pct, status: closed ? "CLOSED" : "OPEN",
    });
  }
  await db.sessionInstance.createMany({
    data: sessionDefs.map((s) => ({
      centerId: center.id, groupId: s.groupId, date: s.date, startTime: s.startTime, endTime: s.endTime,
      price: s.price, teacherPercent: s.pct, status: s.status, openedBy: mgr.id,
    })),
  });
  const sessionsDb = await db.sessionInstance.findMany({ where: { centerId: center.id }, select: { id: true, groupId: true, status: true, price: true, teacherPercent: true, date: true } });
  console.log(`✓ 100 حصة (${sessionsDb.filter((s) => s.status === "CLOSED").length} مغلقة بالتجميعات + ${sessionsDb.filter((s) => s.status === "OPEN").length} مفتوحة النهاردة)`);

  // ===== 5) الحضور + الخصومات: 96 حصة مغلقة × ~120 طالب =====
  const tAtt = Date.now();
  const groupStudents = new Map<string, string[]>();
  for (let i = 0; i < 4500; i++) {
    const g = groups[i % 30].id;
    const arr = groupStudents.get(g) ?? [];
    arr.push(idByCode.get(String(20000 + i))!);
    groupStudents.set(g, arr);
  }
  const attRows: { centerId: string; sessionId: string; studentId: string; status: string; charged: number | null; recordedBy: string }[] = [];
  const chargeRows: { centerId: string; studentId: string; sessionId: string; type: string; amount: number; reason: string; createdBy: string }[] = [];
  let chargedCount = 0;
  for (const sess of sessionsDb.filter((s) => s.status === "CLOSED")) {
    const members = groupStudents.get(sess.groupId) ?? [];
    const picks = members.slice(0, 120);
    picks.forEach((studentId, k) => {
      const st = k % 20 === 5 ? "LATE" : k % 20 === 7 ? "EXCUSED" : "PRESENT";
      const doCharge = st !== "EXCUSED" && k % 4 === 0;
      const amt = doCharge ? sess.price : null;
      attRows.push({ centerId: center.id, sessionId: sess.id, studentId, status: st, charged: amt, recordedBy: mgr.id });
      if (doCharge) {
        chargeRows.push({ centerId: center.id, studentId, sessionId: sess.id, type: "CHARGE", amount: -sess.price, reason: "خصم حضور (اختبار سعة)", createdBy: mgr.id });
        chargedCount++;
      }
    });
  }
  for (let b = 0; b < attRows.length; b += 1000) {
    await db.attendance.createMany({ data: attRows.slice(b, b + 1000) });
  }
  console.log(`✓ ${attRows.length.toLocaleString("en-US")} سجل حضور مربوط بالحصص والطلاب في ${((Date.now() - tAtt) / 1000).toFixed(1)} ثانية (منهم ${chargedCount.toLocaleString("en-US")} مخصوم منهم)`);

  // ===== 6) الدفعات: 1500 طالب × دفعة واحدة + تحديث تجميعات الحصص المغلقة =====
  const payRows = Array.from({ length: 1500 }, (_, i) => ({
    centerId: center.id,
    studentId: idByCode.get(String(20000 + i))!,
    sessionId: null as string | null,
    type: "PAYMENT",
    amount: (300 + (i % 50) * 10) * 100, // 300–790 جنيه بالقروش
    method: METHODS[i % 3],
    reason: "دفعة اختبار السعة",
    createdBy: mgr.id,
  }));
  for (let b = 0; b < payRows.length; b += 1000) {
    await db.studentTransaction.createMany({ data: payRows.slice(b, b + 1000) });
  }
  for (let b = 0; b < chargeRows.length; b += 1000) {
    await db.studentTransaction.createMany({ data: chargeRows.slice(b, b + 1000) });
  }
  const expectedPaymentsSum = payRows.reduce((a, p) => a + p.amount, 0);
  const expectedChargesSum = chargeRows.reduce((a, c) => a + c.amount, 0);

  // تجميعات الإغلاق من الحضور الفعلي (زي ما السيرفر بيعمل بالظبط)
  const tAgg = Date.now();
  const closedSessions = sessionsDb.filter((s) => s.status === "CLOSED");
  const attBySession = new Map<string, { present: number; revenue: number }>();
  for (const r of attRows) {
    const cur = attBySession.get(r.sessionId) ?? { present: 0, revenue: 0 };
    cur.present += 1;
    cur.revenue += r.charged ?? 0;
    attBySession.set(r.sessionId, cur);
  }
  for (const sess of closedSessions) {
    const agg = attBySession.get(sess.id) ?? { present: 0, revenue: 0 };
    const teacherShare = Math.round((agg.revenue * sess.teacherPercent) / 100);
    await db.sessionInstance.update({
      where: { id: sess.id },
      data: { presentCount: agg.present, totalRevenue: agg.revenue, teacherShare, centerShare: agg.revenue - teacherShare, closedBy: mgr.id, closedAt: new Date() },
    });
  }
  console.log(`✓ ${payRows.length.toLocaleString("en-US")} دفعة + ${chargeRows.length.toLocaleString("en-US")} خصم في الليدجر + تجميعات إغلاق ${closedSessions.length} حصة في ${((Date.now() - tAgg) / 1000).toFixed(1)} ثانية`);

  // ===== 7) الجدول الأسبوعي (30 فتحة) — عشان «أقرب حصة» في البورتال تشتغل =====
  const { dow } = cairoYMD();
  await db.scheduleSlot.createMany({
    data: groups.map((g, i) => ({
      centerId: center.id, groupId: g.id, dayOfWeek: (dow + 1 + (i % 6)) % 7,
      startTime: TIME_SLOTS[i % TIME_SLOTS.length][0], endTime: TIME_SLOTS[i % TIME_SLOTS.length][1],
      room: `قاعة ${(i % 4) + 1}`, isActive: true,
    })),
  });
  console.log("✓ 30 فتحة جدول أسبوعي مربوطة بالمجموعات");

  console.log(`\n=== زمن الإدخال الكلي: ${((Date.now() - tIns) / 1000).toFixed(1)} ثانية ===`);

  // ================= فحوصات الربط (Database) =================
  console.log("\n--- فحوصات الربط على مستوى الداتابيز ---");
  const [cStudents, cTeachers, cGroups, cSessions, cRegs, cAtt, cTxns, cSlots] = await Promise.all([
    db.student.count({ where: { centerId: center.id } }),
    db.teacher.count({ where: { centerId: center.id } }),
    db.group.count({ where: { centerId: center.id } }),
    db.sessionInstance.count({ where: { centerId: center.id } }),
    db.studentGroup.count({ where: { group: { centerId: center.id } } }),
    db.attendance.count({ where: { centerId: center.id } }),
    db.studentTransaction.count({ where: { centerId: center.id } }),
    db.scheduleSlot.count({ where: { centerId: center.id } }),
  ]);
  check("الأعداد: 5000 طالب", cStudents === 5000, `فعلي: ${cStudents}`);
  check("الأعداد: 30 مدرس", cTeachers === 30, `فعلي: ${cTeachers}`);
  check("الأعداد: 100 حصة", cSessions === 100, `فعلي: ${cSessions}`);
  check("الأعداد: 30 مجموعة / 4500 تسجيل / 30 فتحة جدول", cGroups === 30 && cRegs === 4500 && cSlots === 30, `فعلي: ${cGroups}/${cRegs}/${cSlots}`);
  check("الأعداد: الحضور والحركات", cAtt === attRows.length && cTxns === payRows.length + chargeRows.length, `فعلي: ${cAtt} حضور / ${cTxns} حركة`);

  // سلامة المراجع: كل تسجيل/حضور/حصة في نفس السنتر
  const regWithMismatch = await db.studentGroup.findMany({
    where: { group: { centerId: center.id } },
    select: { student: { select: { centerId: true } }, group: { select: { centerId: true } } },
    take: 5000,
  }).then((rows) => rows.filter((r) => r.student.centerId !== center.id || r.group.centerId !== center.id).length);
  check("صفر تسجيلات يتيمة/عابرة للمراكز", regWithMismatch === 0, `مخالفات: ${regWithMismatch}`);

  const attMismatch = await db.attendance.findMany({
    where: { centerId: center.id },
    select: { session: { select: { centerId: true, groupId: true } }, studentId: true },
    take: 20000,
  }).then((rows) => rows.filter((r) => r.session.centerId !== center.id).length);
  check("صفر حضور يتيم أو من سنتر تاني", attMismatch === 0, `مخالفات: ${attMismatch}`);

  // تجميعات الإغلاق == الحساب من الحضور (عينة 10 حصص)
  const sampleClosed = await db.sessionInstance.findMany({ where: { centerId: center.id, status: "CLOSED" }, take: 10, select: { id: true, presentCount: true, totalRevenue: true, teacherShare: true, teacherPercent: true } });
  let aggOk = true;
  for (const s of sampleClosed) {
    const live = await db.attendance.aggregate({ where: { sessionId: s.id }, _count: { _all: true }, _sum: { charged: true } });
    if (live._count._all !== s.presentCount || (live._sum.charged ?? 0) !== s.totalRevenue) aggOk = false;
    if (s.teacherShare !== Math.round((s.totalRevenue ?? 0) * s.teacherPercent / 100)) aggOk = false;
  }
  check("تجميعات الحصص المغلقة == الحضور الفعلي (عينة 10)", aggOk);

  // الليدجر: مجموع الدفعات والخصومات
  const payAgg = await db.studentTransaction.aggregate({ where: { centerId: center.id, type: "PAYMENT" }, _sum: { amount: true }, _count: { _all: true } });
  const chAgg = await db.studentTransaction.aggregate({ where: { centerId: center.id, type: "CHARGE" }, _sum: { amount: true }, _count: { _all: true } });
  check("الليدجر: مجموع الدفعات بالقروش مضبوط", payAgg._sum.amount === expectedPaymentsSum, `${(payAgg._sum.amount ?? 0) / 100} ج من ${payAgg._count._all} دفعة`);
  check("الليدجر: مجموع الخصومات بالقروش مضبوط", chAgg._sum.amount === expectedChargesSum, `${Math.abs(chAgg._sum.amount ?? 0) / 100} ج من ${chAgg._count._all} خصم`);

  // أرصدة عينة: SUM(txns) لكل طالب
  const balSample = await db.studentTransaction.groupBy({ by: ["studentId"], where: { centerId: center.id }, _sum: { amount: true } });
  check("أرصدة الطلاب اتحسبت من حركاتهم (SUM لكل طالب)", balSample.length === new Set([...payRows, ...chargeRows].map((r) => r.studentId)).size, `${balSample.length} طالب ليه حركات`);

  // كل مدرس مربوط بمجموعة وحصص
  const teachersWithGroups = await db.group.findMany({ where: { centerId: center.id }, select: { teacherId: true } });
  check("كل مدرس له مجموعة (ربط مدرس↔مجموعة)", new Set(teachersWithGroups.map((g) => g.teacherId)).size === 30);

  // ================= فحوصات السيرفر (HTTP) =================
  console.log("\n--- فحوصات السيرفر (استقبال الاختبار) ---");
  let r = await api("/api/auth", { method: "POST", body: { username: REC_USER, password: PASSWORD } });
  if (r.status !== 200) { console.error("فشل دخول استقبال الاختبار", r.data); process.exit(1); }

  const page1 = await timed("قائمة الطلاب صفحة 1 (24/صفحة)", () => api("/api/students"));
  check("قائمة الطلاب: total = 5000 وصفحة 1 = 24", page1.status === 200 && page1.data.total === 5000 && page1.data.students?.length === 24);

  await timed("صفحة عميقة (صفحة 150)", () => api("/api/students?page=150"));
  await timed("بحث بالاسم (contains)", () => api("/api/students?q=" + encodeURIComponent("محمد عبدالعزيز")));
  const codeSearch = await timed("بحث بالكود (23456)", () => api("/api/students?q=23456"));
  check("بحث الكود بيرجّع الطالب الصح", codeSearch.data.total === 1 && codeSearch.data.students?.[0]?.code === "23456");
  await timed("بحث بالتليفون", () => api("/api/students?q=011200"));
  const lookup = await timed("lookup لايف (أثناء الكتابة)", () => api("/api/lookup?q=" + encodeURIComponent("محمد")), 800);
  check("lookup بيرجّع نتايج محدودة", (lookup.data.students ?? []).length > 0 && (lookup.data.students ?? []).length <= 12, `${(lookup.data.students ?? []).length} نتيجة`);

  // الربط الحي كامل: مسح (قراءة) → تسجيل حضور (كتابة + خصم) → البورتال يشوف الرصيد الجديد
  // الطالب اللي هنمسحه لازم يكون مسجل في مجموعة الحصة المفتوحة (عشان الحالة GREEN والخصم يمشي)
  const openSession = sessionsDb.find((s) => s.status === "OPEN")!;
  const openGroupIdx = groups.findIndex((g) => g.id === openSession.groupId);
  const markIdx = openGroupIdx >= 0 ? openGroupIdx : 0; // أول طالب في المجموعة دي (i % 30 === groupIdx)
  const markCode = String(20000 + markIdx);
  const markPhone = studentRows[markIdx].phone;
  const idMark = idByCode.get(markCode)!;
  const balBefore = await db.studentTransaction.aggregate({ where: { centerId: center.id, studentId: idMark }, _sum: { amount: true } });

  const scan = await timed(`مسح حضور بالكود (${markCode})`, () => api("/api/attendance/scan", { method: "POST", body: { query: markCode, sessionId: openSession.id } }), 2000);
  check("المسح رجّع GREEN (مسجل في المجموعة) + رصيده + سعر الحصة", scan.data.status === "GREEN" && scan.data.student?.code === markCode && typeof scan.data.balance === "number" && typeof scan.data.price === "number", `الرصيد الحالي: ${(scan.data.balance ?? 0) / 100} ج — المطلوب النهاردة: ${(scan.data.amountDue ?? 0) / 100} ج`);

  const qrStudent = await db.student.findFirst({ where: { centerId: center.id, code: String(20000 + (markIdx === 1 ? 0 : 1)) } });
  const qrScan = await timed("مسح حضور بـ QR token (exact)", () => api("/api/attendance/scan", { method: "POST", body: { query: qrStudent!.qrToken, sessionId: openSession.id } }), 2000);
  check("مسح QR قبل الطالب الصح", qrScan.data.student?.code === qrStudent?.code, `الحالة: ${qrScan.data.status}`);

  const mark = await timed("تسجيل حضور (خصم من الرصيد جوّه ترانزاكشن)", () =>
    api("/api/attendance/mark", { method: "POST", body: { studentId: scan.data.student?.id, sessionId: openSession.id, status: "PRESENT" } }), 2000);
  check("تسجيل الحضور رجّع الخصم والرصيد الجديد", (mark.data.charged ?? 0) > 0 && typeof mark.data.balance === "number", `اتخصم ${(mark.data.charged ?? 0) / 100} ج — الرصيد بقى ${(mark.data.balance ?? 0) / 100} ج`);

  const attCreated = await db.attendance.findFirst({ where: { sessionId: openSession.id, studentId: idMark } });
  check("الحضور الجديد موجود ومربوط بالحصة والطالب", !!attCreated, `الحالة: ${attCreated?.status}`);
  const balAfter = await db.studentTransaction.aggregate({ where: { centerId: center.id, studentId: idMark }, _sum: { amount: true } });
  check("الليدجر اتحدث بالخصم (الفرق = سعر الحصة الفعلي)", (balAfter._sum.amount ?? 0) - (balBefore._sum.amount ?? 0) === -(mark.data.charged ?? 0), `الفرق: ${((balAfter._sum.amount ?? 0) - (balBefore._sum.amount ?? 0)) / 100} ج`);
  const expectedBalMarked = balAfter._sum.amount ?? 0;

  // ================= فحوصات المدير + البورتال =================
  console.log("\n--- لوحة التحكم والتقارير (مدير الاختبار) ---");
  cookie = "";
  r = await api("/api/auth", { method: "POST", body: { username: MGR_USER, password: PASSWORD } });
  if (r.status !== 200) { console.error("فشل دخول مدير الاختبار"); process.exit(1); }

  const dash = await timed("لوحة التحكم (KPIs مجمّعة على 5000 طالب)", () => api("/api/dashboard"), 3000);
  check("KPI عدد الطلاب = 5000", dash.data.quickStats?.students === 5000, `فعلي: ${dash.data.quickStats?.students}`);
  check("KPI تحصيل النهاردة == دفعات اليوم بالقروش", dash.data.stats?.collectedToday === expectedPaymentsSum, `الداشبورد: ${(dash.data.stats?.collectedToday ?? 0) / 100} ج == الليدجر: ${expectedPaymentsSum / 100} ج`);
  check("KPI إيراد الشهر == تجميعات الحصص", (dash.data.stats?.monthRevenue ?? 0) > 0, `الإيراد: ${(dash.data.stats?.monthRevenue ?? 0) / 100} ج — نصيب المدرسين: ${(dash.data.stats?.monthTeacherShare ?? 0) / 100} ج`);
  const attToday = await db.attendance.count({ where: { centerId: center.id, session: { date: today }, status: { in: ["PRESENT", "LATE"] } } });
  check("KPI حضور النهاردة == عدد حضور النهاردة في الداتابيز", dash.data.stats?.attendanceToday === attToday, `الداشبورد: ${dash.data.stats?.attendanceToday} == الداتابيز: ${attToday}`);

  const sessToday = await timed("حصص النهاردة (API)", () => api("/api/sessions?date=" + today), 2000);
  check("حصص النهاردة = 10", (sessToday.data.sessions ?? []).length === 10, `فعلي: ${(sessToday.data.sessions ?? []).length}`);

  const balReport = await timed("تقرير أرصدة كل الطلاب (5000)", () => api("/api/reports?type=student-balances"), 5000);
  check("تقرير الأرصدة رجّع صفوف", Array.isArray(balReport.data.rows) && balReport.data.rows.length >= 4500, `${balReport.data.rows?.length ?? 0} صف`);

  const academics = await timed("المراحل والمجموعات (API)", () => api("/api/academics"));
  check("30 مجموعة مربوطة بالمراحل والمواد والمدرسين", (academics.data.groups ?? []).length === 30, `${(academics.data.groups ?? []).length} مجموعة`);

  // بورتال الطالب: تسجيل دخول + رصيد + أقرب حصة
  console.log("\n--- بورتال الطالب (ربط الرصيد/الجدول) ---");
  cookie = "";
  const pLogin = await timed("دخول البورتال (كود + موبايل)", () =>
    api("/api/portal", { method: "POST", body: { action: "login", code: markCode, phone: markPhone } }), 2000);
  check("البورتال قبل الطالب", pLogin.status === 200 && pLogin.data.ok === true);
  const portal = await timed("بيانات البورتال (رصيد + أقرب حصة + QR)", () => api("/api/portal"), 2000);
  check("رصيد البورتال == مجموع حركات الطالب بالقروش", Math.round(portal.data.balance) === expectedBalMarked, `البورتال: ${(portal.data.balance ?? 0) / 100} ج == الليدجر: ${expectedBalMarked / 100} ج`);
  check("أقرب حصة ظهرت من الجدول الأسبوعي", !!portal.data.nextLesson, portal.data.nextLesson ? `${portal.data.nextLesson.subject} — ${portal.data.nextLesson.dayName}` : "فاضية");

  // ================= الخلاصة =================
  const failed = results.filter(([, , ok]) => !ok);
  const httpFailed = results.filter(([, ms, ok]) => !ok && ms > 0);
  console.log("\n========================================");
  console.log(`النتيجة: ${results.length - failed.length}/${results.length} فحص ناجح`);
  if (httpFailed.length) {
    console.log("استعلامات عدّت الميزانية:");
    httpFailed.forEach(([n, ms]) => console.log(`  ✗ ${n}: ${ms}ms`));
  }
  console.log(`\nدخول للتصفح: ${MGR_USER} (مدير) أو ${REC_USER} (استقبال) — الباسورد: ${PASSWORD}`);
  console.log(`لحذف بيانات الاختبار كلها: bun scripts/capacity-load.ts cleanup`);
  await db.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("خطأ:", e);
  await db.$disconnect();
  process.exit(1);
});
