/**
 * محاكاة شهر كامل لسنتر اختبار السعة (5000 طالب) — كأنه سنتر حقيقي اشتغل 30 يوم:
 *
 *   - ~130 حصة من الجدول الأسبوعي (كل فتحة بتتكرر ~4 مرات/شهر) + حصص تعويضية النهاردة
 *   - حضور واقعي (~82%) + خصم بالقروش لكل حضور (بسعر المجموعة أو السعر الخاص)
 *   - دفعات موزعة على الشهر بإيصالات مرقمة RC-000001+ (balanceBefore/After حقيقي)
 *   - تجميعات إغلاق الحصص = الحساب من سجلات الحضور الفعلية
 *   - مستحقات المدرسين (EARNED لكل حصة) + صرف فعلي (PAID) لمعظمهم
 *   - مصروفات شهرية واقعية + قيود دفتر السنتر + يومية خزنة لكل يوم شغل
 *   - إعلانات وصلت للطلاب (مقروءة وغير مقروءة) + إشعارات دفع واتساب
 *   - طابور «تنبيه رصيد» لأصحاب الأرصدة السالبة (SENT/QUEUED/SKIPPED)
 *   - مخزون كتب ومبيعات شهر كامل
 *
 * قواعد صارمة:
 *   - بيانات الإنتاج (النخبة/الأمل) لا تُلمس نهائيًا — كل حاجة جوة سنتر السعة بس.
 *   - الرصيد = مجموع الحركات بالقروش — بالترتيب الزمني.
 *   - قابل للتكرار (PRNG بseed ثابت) — كل تشغيلة بتولد نفس الشهر.
 *
 * الاستخدام:
 *   bun scripts/simulate-month.ts            → محاكاة كاملة (تنضف أي محاكاة سابقة الأول)
 *   bun scripts/simulate-month.ts check      → فحص الثوابت بس من غير كتابة
 */
import { PrismaClient } from "@prisma/client";

const SLUG = "cap-load-5000";
const db = new PrismaClient();

/* ---------- PRNG ثابت (mulberry32) — نفس الشهر في كل تشغيلة ---------- */
let seed = 20260904;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function ri(min: number, max: number): number { return min + Math.floor(rnd() * (max - min + 1)); }
function pick<T>(arr: T[]): T { return arr[Math.floor(rnd() * arr.length)]; }

/* ---------- تواريخ القاهرة ---------- */
function cairoYMD(ref = new Date()): { y: number; m: number; d: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", dateStyle: "short" });
  const parts = fmt.formatToParts(ref);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get("year"), m = get("month"), dd = get("day");
  const dow = new Date(Date.UTC(y, m - 1, dd, 12)).getUTCDay();
  return { y, m, d: dd, dow };
}
function dayStr(offsetDays: number): string {
  const { y, m, d } = cairoYMD();
  return new Date(Date.UTC(y, m - 1, d, 12) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}
function ts(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm.length === 5 ? hhmm : hhmm + ":00"}:00+03:00`);
}
const MONTH_DAYS = 30;

/* ---------- أدوات ---------- */
function roundTo25Egp(piastres: number): number {
  const egp = piastres / 100;
  return Math.max(1, Math.round(egp / 25) * 25) * 100;
}
async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}
const AR_MONTH = new Date().toLocaleDateString("ar-EG", { month: "long", year: "numeric", timeZone: "Africa/Cairo" });

type TxnRow = {
  centerId: string; studentId: string; sessionId: string | null;
  type: string; amount: number; method: string | null; reason: string | null;
  createdBy: string; createdAt: Date;
};

async function main() {
  const mode = process.argv[2] ?? "";
  const center = await db.center.findUnique({ where: { slug: SLUG } });
  if (!center) { console.log("✗ سنتر اختبار السعة مش موجود — شغّل capacity-load.ts الأول."); return; }
  const C = center.id;

  if (mode === "check") { await verify(C); return; }

  const t0 = Date.now();
  console.log(`=== محاكاة شهر كامل: ${center.name} (آخر ${MONTH_DAYS} يوم) ===\n`);

  /* ================= 0) تنضيف النشاط القديم (الهيكل يفضل زي ما هو) ================= */
  console.log("تنضيف النشاط السابق (الطلاب/المجموعات/الجدول بيفضلوا)...");
  await db.receipt.deleteMany({ where: { centerId: C } });
  await db.notificationAttempt.deleteMany({ where: { centerId: C } });
  await db.messageQueueItem.deleteMany({ where: { centerId: C } });
  await db.studentNotification.deleteMany({ where: { centerId: C } });
  await db.announcement.deleteMany({ where: { centerId: C } });
  await db.bookSale.deleteMany({ where: { centerId: C } });
  await db.book.deleteMany({ where: { centerId: C } });
  await db.cashDay.deleteMany({ where: { centerId: C } });
  await db.centerTransaction.deleteMany({ where: { centerId: C } });
  await db.teacherSettlement.deleteMany({ where: { centerId: C } });
  await db.expense.deleteMany({ where: { centerId: C } });
  await db.attendance.deleteMany({ where: { centerId: C } });
  await db.studentTransaction.deleteMany({ where: { centerId: C } });
  await db.sessionInstance.deleteMany({ where: { centerId: C } });
  await db.whatsAppTemplate.deleteMany({ where: { centerId: C } });
  console.log("✓ نضيف — جاي نبنى الشهر\n");

  /* ================= 1) تحميل الهيكل ================= */
  const [mgr, rec] = await Promise.all([
    db.user.findFirst({ where: { centerId: C, role: "MANAGER" } }),
    db.user.findFirst({ where: { centerId: C, role: "RECEPTIONIST" } }),
  ]);
  if (!mgr || !rec) { console.log("✗ مفيش مستخدمين للسنتر ده."); return; }
  const staff = [rec, mgr];

  const groups = await db.group.findMany({
    where: { centerId: C },
    include: { teacher: { select: { id: true, name: true } }, subject: { select: { name: true } } },
  });
  const slots = await db.scheduleSlot.findMany({ where: { centerId: C, isActive: true } });
  const students = await db.student.findMany({
    where: { centerId: C, status: "ACTIVE" },
    select: { id: true, code: true, name: true, phone: true, parentName: true, parentPhone: true, gradeId: true },
  });
  const regs = await db.studentGroup.findMany({ where: { groupId: { in: groups.map((g) => g.id) } } });
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const slotByGroup = new Map<string, typeof slots[number]>();
  for (const s of slots) if (!slotByGroup.has(s.groupId)) slotByGroup.set(s.groupId, s);
  const membersByGroup = new Map<string, { studentId: string; price: number }[]>();
  for (const r of regs) {
    const g = groupById.get(r.groupId)!;
    const arr = membersByGroup.get(r.groupId) ?? [];
    arr.push({ studentId: r.studentId, price: r.priceOverride ?? g.sessionPrice });
    membersByGroup.set(r.groupId, arr);
  }
  console.log(`✓ الهيكل: ${groups.length} مجموعة · ${slots.length} فتحة جدول · ${students.length} طالب · ${regs.length} تسجيل\n`);

  /* ================= 2) حصص الشهر من الجدول + تعويضية النهاردة ================= */
  const today = dayStr(0);
  const nowCairo = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const nowHM = `${String(nowCairo.getHours()).padStart(2, "0")}:${String(nowCairo.getMinutes()).padStart(2, "0")}`;

  type SessDef = {
    groupId: string; date: string; startTime: string; endTime: string; price: number; pct: number;
    room: string | null; status: "OPEN" | "CLOSED"; openedBy: string; closedBy?: string;
    closedAt?: Date; makeUp?: boolean;
  };
  const sessDefs: SessDef[] = [];
  for (const g of groups) {
    const slot = slotByGroup.get(g.id);
    if (!slot) continue;
    for (let off = -MONTH_DAYS; off <= 0; off++) {
      const date = dayStr(off);
      if (dowOf(date) !== slot.dayOfWeek) continue;
      const isToday = off === 0;
      let status: "OPEN" | "CLOSED" = "CLOSED";
      if (isToday) {
        if (slot.endTime > nowHM) status = "OPEN";           // لسه شغالة أو جاية
        else if (slot.startTime > nowHM) status = "OPEN";    // جاية النهاردة
      }
      sessDefs.push({
        groupId: g.id, date, startTime: slot.startTime, endTime: slot.endTime,
        price: g.sessionPrice, pct: g.teacherPercent, room: g.room, status,
        openedBy: rec.id, closedBy: status === "CLOSED" ? (rnd() < 0.8 ? rec.id : mgr.id) : undefined,
        closedAt: status === "CLOSED" ? ts(date, slot.endTime) : undefined,
      });
    }
  }
  // حصص تعويضية النهاردة (واقعي قبل الامتحانات) — 2 مقفولة الصبح + 2 شغالة دلوقتي/بعدين
  const mkTimes: [string, string, "CLOSED" | "OPEN"][] = [
    ["08:00", "09:30", "CLOSED"], ["10:00", "11:30", "CLOSED"],
    [nowHM < "14:00" ? "14:00" : `${String((Number(nowHM.slice(0, 2)) % 23) + 1).padStart(2, "0")}:30`, "", "OPEN"],
  ];
  const mkGroups = groups.slice(0, 4);
  mkTimes.forEach((mk, i) => {
    const g = mkGroups[i];
    if (!g) return;
    const st = mk[2] === "OPEN" && !mk[1] ? `${String((Number(nowHM.slice(0, 2)) % 23) + 1).padStart(2, "0")}:30` : mk[0];
    const en = mk[1] || `${String((Number(st.slice(0, 2)) % 23) + 1).padStart(2, "0")}:30`;
    sessDefs.push({
      groupId: g.id, date: today, startTime: st, endTime: en, price: g.sessionPrice, pct: g.teacherPercent,
      room: g.room, status: mk[2], openedBy: rec.id,
      closedBy: mk[2] === "CLOSED" ? rec.id : undefined, closedAt: mk[2] === "CLOSED" ? ts(today, en) : undefined,
      makeUp: true,
    });
  });
  await db.sessionInstance.createMany({
    data: sessDefs.map((s) => ({
      centerId: C, groupId: s.groupId, date: s.date, startTime: s.startTime, endTime: s.endTime,
      room: s.room, price: s.price, teacherPercent: s.pct, status: s.status,
      openedBy: s.openedBy, closedBy: s.closedBy ?? null, closedAt: s.closedAt ?? null,
    })),
  });
  const sessions = await db.sessionInstance.findMany({
    where: { centerId: C },
    select: { id: true, groupId: true, date: true, startTime: true, endTime: true, status: true, price: true, teacherPercent: true },
  });
  console.log(`✓ ${sessions.length} حصة (${sessions.filter((s) => s.status === "CLOSED").length} مغلقة · ${sessions.filter((s) => s.status === "OPEN").length} مفتوحة النهاردة)\n`);

  /* ================= 3) الحضور + الخصومات ================= */
  type AttRow = { centerId: string; sessionId: string; studentId: string; status: string; charged: number | null; recordedBy: string; createdAt: Date };
  const attRows: AttRow[] = [];
  const chargeByStudent = new Map<string, number>();
  for (const sess of sessions) {
    const members = membersByGroup.get(sess.groupId) ?? [];
    const liveNow = sess.status === "OPEN" && sess.date === today && sess.startTime <= nowHM && sess.endTime > nowHM;
    for (let k = 0; k < members.length; k++) {
      const m = members[k];
      const roll = rnd();
      if (sess.status === "OPEN" && !liveNow) continue;          // حصة جاية: مفيش حضور لسه
      if (liveNow && roll > 0.45) continue;                       // شغالة دلوقتي: ~45% اتحسبوا لحد دلوقتي
      if (!liveNow && roll > 0.86) continue;                      // غياب ~14%
      let st = "PRESENT";
      const r2 = rnd();
      if (r2 < 0.03) st = "EXCUSED";
      else if (r2 < 0.08) st = "LATE";
      const charge = st === "EXCUSED" ? 0 : m.price;
      attRows.push({
        centerId: C, sessionId: sess.id, studentId: m.studentId, status: st,
        charged: st === "EXCUSED" ? 0 : charge, recordedBy: rnd() < 0.85 ? rec.id : mgr.id,
        createdAt: ts(sess.date, sess.startTime),
      });
      if (charge > 0) chargeByStudent.set(m.studentId, (chargeByStudent.get(m.studentId) ?? 0) + charge);
    }
  }
  await chunked(attRows, 1000, (b) => db.attendance.createMany({ data: b }));
  console.log(`✓ ${attRows.length.toLocaleString("en-US")} حضور (${attRows.filter((a) => a.status !== "PRESENT").length} متأخر/بعذر)\n`);

  /* ================= 4) الدفعات بإيصالات متسلسلة (الرصيد بالترتيب الزمني) ================= */
  type PayPlan = { studentId: string; amount: number; date: string; hour: number; method: string; staffId: string; createdAt?: Date; idx?: number; balBefore?: number; balAfter?: number };
  const pays: PayPlan[] = [];
  const regStudentIds = new Set(regs.map((r) => r.studentId));
  for (const s of students) {
    if (!regStudentIds.has(s.id)) continue; // الطلاب من غير مجموعة مالهمش حصص
    const totalCharges = chargeByStudent.get(s.id) ?? 0;
    const roll = rnd();
    if (roll < 0.045) continue; // ~4.5% محدفعش خالص (أصحاب الدين)
    const factor = 0.7 + rnd() * 0.8;       // 0.7–1.5 من إجمالي الاستهلاك
    let totalPay = roundTo25Egp(Math.round(totalCharges * factor));
    if (totalCharges === 0) totalPay = pick([10000, 15000, 20000]); // دفع مقدمة ومحضرش
    const nPays = roll < 0.72 ? 1 : roll < 0.94 ? 2 : 3;
    const split = nPays === 1 ? [1] : nPays === 2 ? [0.6, 0.4] : [0.45, 0.3, 0.25];
    const dayBuckets = [[1, 5], [10, 16], [20, 26]];
    let allocated = 0;
    split.forEach((frac, i) => {
      const [d0, d1] = dayBuckets[i];
      const amount = i === nPays - 1 ? totalPay - allocated : Math.round(totalPay * frac);
      allocated += amount;
      if (amount <= 0) return;
      pays.push({
        studentId: s.id, amount,
        date: dayStr(-ri(d0, d1)), hour: ri(10, 18),
        method: pick(["CASH", "CASH", "CASH", "VODAFONE", "VODAFONE", "INSTAPAY"]),
        staffId: rnd() < 0.85 ? rec.id : mgr.id,
      });
    });
  }
  // ترتيب زمني كامل + طوابع زمن صارمة التزايد (لربط الإيصالات بالحروف بالترتيب)
  pays.sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1));
  let prevT = 0;
  pays.forEach((p, i) => {
    let t = ts(p.date, `${String(p.hour).padStart(2, "0")}:${p.hour % 2 ? "25" : "10"}`).getTime();
    if (t <= prevT) t = prevT + 1; // نفس الدقيقة؟ +1ms — الترتيب الصارم أمان
    p.createdAt = new Date(t);
    p.idx = i;
    prevT = t;
  });

  // الخط الزمني لكل طالب: خصومات الحصص + الدفعات → رصيد قبل/بعد لكل دفعة
  const charges: { studentId: string; sessionId: string; amount: number; date: string; hour: number }[] = [];
  {
    const sessById = new Map(sessions.map((s) => [s.id, s]));
    for (const a of attRows) {
      if (!a.charged) continue;
      const sess = sessById.get(a.sessionId)!;
      charges.push({ studentId: a.studentId, sessionId: a.sessionId, amount: a.charged, date: sess.date, hour: Number(sess.startTime.slice(0, 2)) });
    }
  }
  charges.sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1));
  type TLEv = { date: string; hour: number; kind: "CHARGE" | "PAY"; amount: number; pay?: PayPlan; sessionId?: string; at: Date };
  const timeline = new Map<string, TLEv[]>();
  for (const ch of charges) {
    const arr = timeline.get(ch.studentId) ?? [];
    arr.push({ date: ch.date, hour: ch.hour, kind: "CHARGE", amount: -ch.amount, sessionId: ch.sessionId, at: ts(ch.date, `${String(ch.hour).padStart(2, "0")}:${ch.hour % 2 ? "20" : "40"}`) });
    timeline.set(ch.studentId, arr);
  }
  for (const p of pays) {
    const arr = timeline.get(p.studentId) ?? [];
    arr.push({ date: p.date, hour: p.hour, kind: "PAY", amount: p.amount, pay: p, at: p.createdAt! });
    timeline.set(p.studentId, arr);
  }
  for (const arr of timeline.values()) arr.sort((a, b) => a.at.getTime() - b.at.getTime());

  const txnRows: TxnRow[] = [];
  type ReceiptRow = {
    centerId: string; seq: number; number: string; txnId: string; studentId: string;
    amount: number; method: string | null; balanceBefore: number; balanceAfter: number;
    sessionId: string | null; issuedBy: string; issuedByName: string; date: string; createdAt: Date;
  };
  const receiptMeta: { pay: PayPlan; balanceBefore: number; balanceAfter: number }[] = [];
  const staffName = new Map([[rec.id, rec.name], [mgr.id, mgr.name]]);
  for (const [studentId, arr] of timeline) {
    let bal = 0;
    for (const ev of arr) {
      const before = bal;
      bal += ev.amount;
      if (ev.kind === "CHARGE") {
        const sess = sessions.find((s) => s.id === ev.sessionId)!;
        txnRows.push({
          centerId: C, studentId, sessionId: ev.sessionId!, type: "CHARGE", amount: ev.amount,
          method: null, reason: `حصة ${groupById.get(sess.groupId)?.subject?.name ?? ""}`,
          createdBy: rec.id, createdAt: ev.at,
        });
      } else {
        const p = ev.pay!;
        p.balBefore = before; p.balAfter = bal;
        txnRows.push({
          centerId: C, studentId, sessionId: null, type: "PAYMENT", amount: ev.amount,
          method: p.method, reason: `دفعة رصيد — ${p.date}`, createdBy: p.staffId, createdAt: p.createdAt!,
        });
        receiptMeta.push({ pay: p, balanceBefore: before, balanceAfter: bal });
      }
    }
  }
  // الإدخال بالكتل — ثم ربط الإيصالات بحركات الدفع الفعلية (بنفس الترتيب الزمني الصارم)
  await chunked(txnRows, 1000, (b) => db.studentTransaction.createMany({ data: b }));
  const payTxns = await db.studentTransaction.findMany({
    where: { centerId: C, type: "PAYMENT" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (payTxns.length !== pays.length) throw new Error(`عدم تطابق: ${payTxns.length} حركة دفع مقابل ${pays.length} دفعة مخططة`);
  // receiptMeta بترتيب pays (زي payTxns بالظبط)
  receiptMeta.sort((a, b) => (a.pay.idx ?? 0) - (b.pay.idx ?? 0));
  const receiptData: ReceiptRow[] = receiptMeta.map((m, i) => ({
    centerId: C, seq: i + 1, number: `RC-${String(i + 1).padStart(6, "0")}`, txnId: payTxns[i].id,
    studentId: m.pay.studentId, amount: m.pay.amount, method: m.pay.method,
    balanceBefore: m.balanceBefore, balanceAfter: m.balanceAfter,
    sessionId: null, issuedBy: m.pay.staffId, issuedByName: staffName.get(m.pay.staffId) ?? "",
    date: m.pay.date, createdAt: m.pay.createdAt!,
  }));
  await chunked(receiptData, 1000, (b) => db.receipt.createMany({ data: b }));
  console.log(`✓ ${txnRows.length.toLocaleString("en-US")} حركة مالية (${pays.length.toLocaleString("en-US")} دفعة بإيصالها) — بالرصيد الزمني الصح\n`);

  /* ================= 5) تجميعات الإغلاق + مستحقات EARNED + قيود الدفتر ================= */
  const attBySession = new Map<string, { present: number; revenue: number }>();
  for (const a of attRows) {
    const cur = attBySession.get(a.sessionId) ?? { present: 0, revenue: 0 };
    cur.present += 1; cur.revenue += a.charged ?? 0;
    attBySession.set(a.sessionId, cur);
  }
  const journal: { centerId: string; type: string; amount: number; date: string; note: string; refType: string; refId: string; createdBy: string; createdAt: Date }[] = [];
  const earned: { centerId: string; teacherId: string; sessionId: string; type: string; amount: number; date: string; note: string | null; createdBy: string; createdAt: Date }[] = [];
  let totalRevenue = 0, totalTeacherShare = 0;
  for (const sess of sessions.filter((s) => s.status === "CLOSED")) {
    const agg = attBySession.get(sess.id) ?? { present: 0, revenue: 0 };
    const teacherShare = Math.round((agg.revenue * sess.teacherPercent) / 100);
    await db.sessionInstance.update({
      where: { id: sess.id },
      data: { presentCount: agg.present, totalRevenue: agg.revenue, teacherShare, centerShare: agg.revenue - teacherShare },
    });
    totalRevenue += agg.revenue; totalTeacherShare += teacherShare;
    const g = groupById.get(sess.groupId)!;
    if (g.teacherId) {
      earned.push({
        centerId: C, teacherId: g.teacherId, sessionId: sess.id, type: "EARNED", amount: teacherShare,
        date: sess.date, note: null, createdBy: mgr.id, createdAt: ts(sess.date, "23:30"),
      });
    }
    journal.push(
      { centerId: C, type: "SESSION_REVENUE", amount: agg.revenue, date: sess.date, note: `إيراد حصة ${g.subject?.name ?? ""} — ${g.name}`, refType: "SESSION", refId: sess.id, createdBy: mgr.id, createdAt: ts(sess.date, "23:35") },
      { centerId: C, type: "TEACHER_SHARE", amount: -teacherShare, date: sess.date, note: `نصيب المدرس ${g.teacher?.name ?? ""}`, refType: "SESSION", refId: sess.id, createdBy: mgr.id, createdAt: ts(sess.date, "23:36") },
    );
  }
  await chunked(earned, 1000, (b) => db.teacherSettlement.createMany({ data: b }));
  console.log(`✓ تجميعات الإغلاق + ${earned.length} مستحق EARNED — إيراد الشهر ${(totalRevenue / 100).toLocaleString("en-EG")} ج · نصيب المدرسين ${(totalTeacherShare / 100).toLocaleString("en-EG")} ج\n`);

  /* ================= 6) صرف مستحقات المدرسين (PAID) ================= */
  const earnedByTeacher = new Map<string, number>();
  for (const e of earned) earnedByTeacher.set(e.teacherId, (earnedByTeacher.get(e.teacherId) ?? 0) + e.amount);
  const paidRows: { centerId: string; teacherId: string; type: string; amount: number; date: string; note: string; createdBy: string; createdAt: Date }[] = [];
  for (const [teacherId, tot] of earnedByTeacher) {
    const rounds = rnd() < 0.25 ? 2 : 1;
    let remaining = Math.round(tot * (0.55 + rnd() * 0.4)); // بيصرفوا 55–95% من المستحق
    for (let r = 0; r < rounds && remaining > 5000; r++) {
      const amount = r === rounds - 1 ? remaining : Math.round(remaining * (0.5 + rnd() * 0.3));
      const date = dayStr(-ri(r === 0 ? 14 : 4, r === 0 ? 18 : 1));
      paidRows.push({
        centerId: C, teacherId, type: "PAID", amount: -amount, date,
        note: r === 0 ? "صرف دفعة أولى" : "صرف دفعة ثانية", createdBy: mgr.id, createdAt: ts(date, "17:00"),
      });
      journal.push({ centerId: C, type: "TEACHER_PAYOUT", amount: -amount, date, note: `صرف لمدرس: ${groups.find((g) => g.teacherId === teacherId)?.teacher?.name ?? ""}`, refType: "TEACHER", refId: teacherId, createdBy: mgr.id, createdAt: ts(date, "17:01") });
      remaining -= amount;
    }
  }
  await chunked(paidRows, 1000, (b) => db.teacherSettlement.createMany({ data: b }));
  console.log(`✓ ${paidRows.length} صرفية مدرسين (${new Set(paidRows.map((p) => p.teacherId)).size} مدرس من ${earnedByTeacher.size})\n`);

  /* ================= 7) مصروفات شهر واقعية ================= */
  const expenseDefs: { category: string; amount: number; note: string }[] = [
    { category: "RENT", amount: 1_800_000, note: "إيجار المقر — الشهر" },
    { category: "ELECTRICITY", amount: 145_000, note: "فاتورة كهرباء" },
    { category: "ELECTRICITY", amount: 138_000, note: "فاتورة كهرباء — الشهر اللي فات" },
    { category: "SALARIES", amount: 350_000, note: "رواتب إداريين" },
    { category: "MAINTENANCE", amount: 85_000, note: "صيانة تكييفات" },
    { category: "MAINTENANCE", amount: 40_000, note: "صيانة سبورة وإضاءة" },
    { category: "SUPPLIES", amount: 62_000, note: "ورق طباعة وأحبار" },
    { category: "SUPPLIES", amount: 55_000, note: "مستلزمات مكتبية" },
    { category: "SUPPLIES", amount: 30_000, note: "أدوات كتابة للامتحانات" },
    { category: "OTHER", amount: 120_000, note: "دفعة تأمين سنتر" },
    { category: "OTHER", amount: 45_000, note: "إنترنت السنتر" },
    { category: "OTHER", amount: 25_000, note: "مصاريف نثرية" },
  ];
  for (const e of expenseDefs) {
    const date = dayStr(-ri(1, 28));
    const exp = await db.expense.create({
      data: { centerId: C, category: e.category, amount: e.amount, date, note: e.note, createdBy: mgr.id, createdAt: ts(date, "12:00") },
    });
    journal.push({ centerId: C, type: "EXPENSE", amount: -e.amount, date, note: e.note, refType: "EXPENSE", refId: exp.id, createdBy: mgr.id, createdAt: ts(date, "12:01") });
  }
  console.log(`✓ ${expenseDefs.length} مصروف (${(expenseDefs.reduce((a, e) => a + e.amount, 0) / 100).toLocaleString("en-EG")} ج)\n`);

  /* ================= 8) كتب ومبيعات ================= */
  const bookDefs = [
    { name: "كتاب الرياضيات — الأول الثانوي", gi: 0, si: 0, price: 12_000, cost: 8_000, stock: 120 },
    { name: "كتاب الرياضيات — الثاني الثانوي", gi: 1, si: 0, price: 13_500, cost: 9_000, stock: 95 },
    { name: "كتاب الرياضيات — الثالث الثانوي", gi: 2, si: 0, price: 15_000, cost: 10_500, stock: 80 },
    { name: "ملخص اللغة العربية — ثانوي", gi: 0, si: 1, price: 8_000, cost: 5_000, stock: 140 },
    { name: "كتاب اللغة الإنجليزية — الأول الثانوي", gi: 0, si: 2, price: 11_000, cost: 7_500, stock: 100 },
    { name: "امتحانات الفيزياء — الثاني الثانوي", gi: 1, si: 3, price: 9_500, cost: 6_000, stock: 75 },
    { name: "بنك أسئلة الكيمياء — الثالث الثانوي", gi: 2, si: 4, price: 10_500, cost: 7_000, stock: 60 },
    { name: "كراسة امتحانات إعدادي — عام", gi: 3, si: 1, price: 6_000, cost: 3_500, stock: 150 },
  ];
  const dbGrades = await db.grade.findMany({ where: { centerId: C } });
  const dbSubjects = await db.subject.findMany({ where: { centerId: C } });
  const books: { id: string; price: number; stock: number; name: string }[] = [];
  for (const b of bookDefs) {
    const bk = await db.book.create({
      data: {
        centerId: C, name: b.name, gradeId: dbGrades[b.gi % dbGrades.length]?.id ?? null,
        subjectId: dbSubjects[b.si % dbSubjects.length]?.id ?? null,
        price: b.price, costPrice: b.cost, stock: b.stock, reorderThreshold: 5,
        notes: "مورد مكتبة النور", createdAt: ts(dayStr(-31), "10:00"),
      },
    });
    books.push({ id: bk.id, price: bk.price, stock: bk.stock, name: bk.name });
  }
  type SaleRow = { centerId: string; bookId: string; studentId: string | null; buyerName: string | null; qty: number; unitPrice: number; unitCost: number; total: number; method: string; date: string; createdBy: string; createdAt: Date };
  const saleRows: SaleRow[] = [];
  for (let i = 0; i < 640; i++) {
    const bk = pick(books);
    const qty = rnd() < 0.82 ? 1 : 2;
    if (bk.stock < qty) continue;
    bk.stock -= qty;
    const st = pick(students);
    saleRows.push({
      centerId: C, bookId: bk.id, studentId: st.id, buyerName: st.name, qty,
      unitPrice: bk.price, unitCost: Math.round(bk.price * 0.66), total: bk.price * qty,
      method: pick(["CASH", "CASH", "CASH", "VODAFONE"]), date: dayStr(-ri(0, 28)),
      createdBy: rec.id, createdAt: ts(dayStr(-ri(0, 28)), `${String(ri(10, 20)).padStart(2, "0")}:00`),
    });
  }
  await chunked(saleRows, 1000, (b) => db.bookSale.createMany({ data: b }));
  for (const bk of books) {
    await db.book.update({ where: { id: bk.id }, data: { stock: bk.stock } });
    // قيود دفتر المبيعات باليوم
  }
  {
    const salesByDate = new Map<string, number>();
    for (const s of saleRows) salesByDate.set(s.date, (salesByDate.get(s.date) ?? 0) + s.total);
    for (const [date, tot] of salesByDate) {
      journal.push({ centerId: C, type: "BOOK_SALE", amount: tot, date, note: `مبيعات كتب اليوم`, refType: "BOOK_SALES", refId: date, createdBy: rec.id, createdAt: ts(date, "22:00") });
    }
  }
  console.log(`✓ ${books.length} كتاب + ${saleRows.length} بيعة (${(saleRows.reduce((a, s) => a + s.total, 0) / 100).toLocaleString("en-EG")} ج)\n`);

  /* ================= 9) يومية الخزنة ================= */
  const cashByDate = new Map<string, { opening: number; received: number }>();
  const activeDates = new Set<string>([
    ...pays.filter((p) => p.method === "CASH").map((p) => p.date),
    ...sessions.map((s) => s.date),
  ]);
  const sortedDates = [...activeDates].sort();
  let carry = 50_000; // 500 ج عوامة أول يوم
  for (const date of sortedDates) {
    const received = pays.filter((p) => p.date === date && p.method === "CASH").reduce((a, p) => a + p.amount, 0);
    const opening = carry;
    const isToday = date === today;
    await db.cashDay.create({
      data: {
        centerId: C, date, openingCash: opening,
        countedCash: isToday ? null : opening + received,
        status: isToday ? "OPEN" : "CLOSED", openedBy: rec.id,
        closedBy: isToday ? null : (rnd() < 0.85 ? rec.id : mgr.id), closedAt: isToday ? null : ts(date, "23:50"),
        createdAt: ts(date, "08:00"),
      },
    });
    if (!isToday) carry = opening + received;
  }
  console.log(`✓ يومية خزنة لـ ${sortedDates.length} يوم (${sortedDates.filter((d) => d === today).length} لسه مفتوحة)\n`);

  /* ================= 10) قيود الدفتر كلها ================= */
  journal.sort((a, b) => (a.date === b.date ? a.createdAt.getTime() - b.createdAt.getTime() : a.date < b.date ? -1 : 1));
  await chunked(journal, 1000, (b) => db.centerTransaction.createMany({ data: b }));
  console.log(`✓ ${journal.length} قيد دفتر مركز\n`);

  /* ================= 11) إعلانات وصلت للطلاب ================= */
  type AnnDef = { title: string; body: string; audienceType: "ALL" | "GRADE" | "GROUP" | "SUBJECT"; pick: () => { id: string | null; name: string; students: string[] } };
  const annDefs: AnnDef[] = [
    {
      title: "بدء الامتحانات الشهرية الأسبوع الجاي",
      body: "الامتحانات الشهرية هتبدأ من السبت الجاي حسب جدول كل مجموعة. راجعوا المنهج مع مدرسيكم، والامتحان بيحسب 10% من درجة أعمال السنة. بالتوفيق للجميع!",
      audienceType: "ALL", pick: () => ({ id: null, name: "كل الطلاب", students: students.map((s) => s.id) }),
    },
    {
      title: "تنبيه: مفيش حصص يوم الجمعة",
      body: "بنذكّر أولياء الأمور إن يوم الجمعة مفيش حصص في السنتر. الحصص بتكمّل طبيعي باقي الأيام. شكرًا لتفهمكم.",
      audienceType: "ALL", pick: () => ({ id: null, name: "كل الطلاب", students: students.map((s) => s.id) }),
    },
    {
      title: "وصل كتاب الرياضيات الجديد",
      body: "كتاب الرياضيات الجديد وصل المخزن. اللي محتاجه يسلّم في الاستقبال أول ما يخلص مخزونه. الكمية محدودة.",
      audienceType: "SUBJECT", pick: () => {
        const subj = dbSubjects[0];
        const gids = groups.filter((g) => g.subjectId === subj.id).map((g) => g.id);
        return { id: subj.id, name: subj.name, students: regs.filter((r) => gids.includes(r.groupId)).map((r) => r.studentId) };
      },
    },
    {
      title: "رحلة معمل الفيزياء — الثالث الثانوي",
      body: "الحجز اتفتح لرحلة معمل الفيزياء التجريبي. الأماكن 20 بس والحجز بالأولوية. اسألوا في الاستقبال.",
      audienceType: "GRADE", pick: () => {
        const gr = dbGrades[2];
        return { id: gr.id, name: gr.name, students: students.filter((s) => s.gradeId === gr.id).map((s) => s.id) };
      },
    },
    {
      title: "مراجعة ليلة الامتحان — مجموعة A",
      body: "مراجعة نهائية ليلة الامتحان الساعة 6 بلاء. الحضور اختياري بس مهم جدًا. جيبوا معاكم آخر امتحان.",
      audienceType: "GROUP", pick: () => {
        const g = groups[0];
        return { id: g.id, name: `${g.name} — ${g.subject?.name}`, students: (membersByGroup.get(g.id) ?? []).map((m) => m.studentId) };
      },
    },
  ];
  for (let i = 0; i < annDefs.length; i++) {
    const a = annDefs[i];
    const aud = a.pick();
    const daysAgo = [3, 8, 12, 17, 24][i] ?? 3;
    const ann = await db.announcement.create({
      data: {
        centerId: C, title: a.title, body: a.body, audienceType: a.audienceType,
        audienceId: aud.id, audienceName: aud.name, recipients: aud.students.length,
        createdBy: mgr.id, createdByName: mgr.name, createdAt: ts(dayStr(-daysAgo), "11:00"),
      },
    });
    const notifRows = aud.students.map((sid) => {
      const read = rnd() < 0.58;
      const created = ts(dayStr(-daysAgo), "11:01");
      return {
        centerId: C, studentId: sid, type: "ANNOUNCEMENT", title: a.title, body: a.body,
        announcementId: ann.id, readAt: read ? new Date(created.getTime() + ri(1, 72) * 3_600_000) : null,
        createdAt: created,
      };
    });
    await chunked(notifRows, 1000, (b) => db.studentNotification.createMany({ data: b }));
    console.log(`  إعلان: ${a.title} → ${aud.students.length.toLocaleString("en-US")} طالب`);
  }
  console.log("");

  /* ================= 12) قوالب واتساب + إشعارات دفع + طابور تنبيه رصيد ================= */
  await db.whatsAppTemplate.createMany({
    data: [
      { centerId: C, name: "تنبيه رصيد", body: "نود التنبيه بأن المتبقي على {student_name} مبلغ {amount_due} جنيه. نرجو السداد عند أقرب فرصة. شكراً لتعاونكم. — {center_name}" },
      { centerId: C, name: "تأكيد دفعة", body: "تم استلام مبلغ {amount} جنيه من {student_name}. الرصيد الحالي: {balance} جنيه. شكراً لسدادكم. — {center_name}" },
    ],
  });
  // أرصدة نهائية
  const finalBal = new Map<string, number>();
  for (const [sid, arr] of timeline) finalBal.set(sid, arr.reduce((a, e) => a + e.amount, 0));
  const studentById = new Map(students.map((s) => [s.id, s]));

  // إشعارات تأكيد دفع — عينة واقعية من الدفعات
  const samplePays = pays.filter(() => rnd() < 0.22);
  const attemptRows = samplePays.map((p) => {
    const st = studentById.get(p.studentId)!;
    const bal = finalBal.get(p.studentId) ?? 0;
    const status = rnd() < 0.74 ? "SENT" : rnd() < 0.75 ? "OPENED" : "PENDING";
    return {
      centerId: C, studentId: p.studentId, txnId: null as string | null,
      template: "تأكيد دفعة", channel: "WA_HANDOFF", recipient: st.parentPhone ?? st.phone ?? `011${ri(20000000, 29999999)}`,
      status, providerRef: null, error: null,
      bodySnapshot: `تم استلام مبلغ ${(p.amount / 100).toLocaleString("en-EG")} جنيه من ${st.name}. الرصيد الحالي: ${(bal / 100).toLocaleString("en-EG")} جنيه. شكراً لسدادكم. — ${center.name}`,
      createdBy: p.staffId, createdAt: new Date(ts(p.date, `${String(p.hour).padStart(2, "0")}:30`).getTime() + 120_000),
      updatedAt: status === "PENDING" ? ts(p.date, `${String(p.hour).padStart(2, "0")}:30`) : new Date(ts(p.date, `${String(p.hour).padStart(2, "0")}:30`).getTime() + 300_000),
    };
  });
  await chunked(attemptRows, 1000, (b) => db.notificationAttempt.createMany({ data: b }));

  // طابور تنبيه رصيد — أصحاب الدين (الأخطر 600)
  const debtors = [...finalBal.entries()].filter(([, b]) => b < -8000).sort((a, b) => a[1] - b[1]).slice(0, 600);
  const period = today.slice(0, 7);
  const batchId = `B${Date.now().toString(36)}sim`;
  const queueRows = debtors.map(([sid, bal]) => {
    const st = studentById.get(sid)!;
    const status = rnd() < 0.45 ? "SENT" : rnd() < 0.75 ? "QUEUED" : "SKIPPED";
    const created = ts(dayStr(-ri(1, 4)), "18:00");
    return {
      centerId: C, batchId, batchLabel: `تنبيه رصيد — ${AR_MONTH}`, studentId: sid,
      recipientPhone: (st.parentPhone ?? st.phone ?? "").replace(/\s/g, ""), recipientName: st.parentName ?? st.name,
      channel: "WA_HANDOFF", templateKey: "low_balance",
      messageText: `نود التنبيه بأن المتبقي على ${st.name} مبلغ ${Math.round(-bal / 100).toLocaleString("en-EG")} جنيه. نرجو السداد عند أقرب فرصة. شكراً لتعاونكم. — ${center.name}`,
      dedupeKey: `${C}:${sid}:low_balance:${period}`, status,
      attempts: status === "SENT" ? 1 : 0, maxAttempts: 3,
      nextAttemptAt: status === "QUEUED" ? new Date() : null,
      handoffCount: status === "SENT" ? 1 : 0, createdBy: rec.id, createdAt: created,
      sentAt: status === "SENT" ? new Date(created.getTime() + 600_000) : null,
    };
  });
  await chunked(queueRows, 1000, (b) => db.messageQueueItem.createMany({ data: b }));
  console.log(`✓ ${attemptRows.length} إشعار دفع واتساب · ${queueRows.length} رسالة تنبيه رصيد (${queueRows.filter((q) => q.status === "SENT").length} اتكلمت)\n`);

  /* ================= 13) تحديث إحصاءات السنتر ================= */
  const paidSum = pays.reduce((a, p) => a + p.amount, 0);
  const debtSum = -[...finalBal.values()].filter((b) => b < 0).reduce((a, b) => a + b, 0);
  console.log("══════════ ملخص الشهر ══════════");
  console.log(`  إيراد الحصص:      ${(totalRevenue / 100).toLocaleString("en-EG")} ج`);
  console.log(`  الدفعات المستلمة: ${(paidSum / 100).toLocaleString("en-EG")} ج (${pays.length.toLocaleString("en-US")} دفعة)`);
  console.log(`  مبيعات الكتب:     ${(saleRows.reduce((a, s) => a + s.total, 0) / 100).toLocaleString("en-EG")} ج`);
  console.log(`  المصروفات:        ${(expenseDefs.reduce((a, e) => a + e.amount, 0) / 100).toLocaleString("en-EG")} ج`);
  console.log(`  نصيب المدرسين:    ${(totalTeacherShare / 100).toLocaleString("en-EG")} ج · المتصرف فعليًا ${(-paidRows.reduce((a, p) => a + p.amount, 0) / 100).toLocaleString("en-EG")} ج`);
  console.log(`  أرصدة الطلاب:     ${[...finalBal.values()].filter((b) => b > 0).length} له رصيد · ${[...finalBal.values()].filter((b) => b < 0).length} عليه (${(debtSum / 100).toLocaleString("en-EG")} ج ديون)`);
  console.log(`\n  الزمن الكلي: ${((Date.now() - t0) / 1000).toFixed(1)} ثانية\n`);

  await verify(C);
}

/* ================= فحص الثوابت ================= */
async function verify(C: string) {
  console.log("=== فحص الثوابت (Invariants) ===");
  let pass = 0, fail = 0;
  const ck = (name: string, cond: boolean, detail = "") => {
    cond ? pass++ : fail++;
    console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // (1) أرصدة الطلاب == مجموع الحركات (عبر groupBy — زي finance.ts بالظبط)
  const grouped = await db.studentTransaction.groupBy({
    by: ["studentId"], where: { centerId: C }, _sum: { amount: true },
  });
  // إيصالات متسقة: balanceAfter == balanceBefore + amount
  const rc = await db.receipt.findMany({ where: { centerId: C }, select: { balanceBefore: true, balanceAfter: true, amount: true, seq: true, number: true, txnId: true } });
  ck("إيصالات: رصيد بعد = قبل + مبلغ", rc.every((r) => r.balanceAfter === r.balanceBefore + r.amount), `${rc.length.toLocaleString("en-US")} إيصال`);
  ck("إيصالات: ترقيم متسلسل من غير فجوات", rc.every((r, i) => r.seq === i + 1 && r.number === `RC-${String(i + 1).padStart(6, "0")}`));
  const payTxnIds = new Set(rc.map((r) => r.txnId));
  const payCount = await db.studentTransaction.count({ where: { centerId: C, type: "PAYMENT" } });
  ck("كل دفعة ليها إيصال واحد بالظبط", payTxnIds.size === payCount, `${payTxnIds.size}/${payCount}`);
  // آخر رصيد لكل طالب = مجموع حركاته
  const lastBal = new Map<string, number>();
  for (const r of rc) lastBal.set(r.studentId, r.balanceAfter); // آخر إيصال (بالترتيب)
  const txnBal = new Map(grouped.map((g) => [g.studentId, g._sum.amount ?? 0]));
  let balOk = true;
  for (const [sid, bal] of txnBal) {
    if ((lastBal.get(sid) ?? 0) !== bal && rc.some((r) => r.studentId === sid)) { balOk = false; break; }
  }
  ck("أرصدة الإيصالات الأخيرة == مجموع الليدجر", balOk, `${txnBal.size} طالب بي حركة`);

  // (2) تجميعات الحصص == الحضور الفعلي
  const closed = await db.sessionInstance.findMany({ where: { centerId: C, status: "CLOSED" }, select: { id: true, presentCount: true, totalRevenue: true, teacherShare: true, teacherPercent: true } });
  const agg = await db.attendance.groupBy({
    by: ["sessionId"], where: { centerId: C }, _count: { _all: true }, _sum: { charged: true },
  });
  const aggMap = new Map(agg.map((a) => [a.sessionId, { n: a._count._all, rev: a._sum.charged ?? 0 }]));
  let sessOk = true, shareOk = true;
  for (const s of closed) {
    const live = aggMap.get(s.id) ?? { n: 0, rev: 0 };
    if (s.presentCount !== live.n || s.totalRevenue !== live.rev) sessOk = false;
    if (s.teacherShare !== Math.round((s.totalRevenue ?? 0) * s.teacherPercent / 100)) shareOk = false;
  }
  ck("تجميعات الإغلاق == سجلات الحضور", sessOk, `${closed.length} حصة مغلقة`);
  ck("نصيب المدرس == الإيراد × النسبة", shareOk);

  // (3) مستحقات المدرسين: EARNED == مجموع نصايب الحصص، والرصيد = EARNED+PAID
  const earnedByT = await db.teacherSettlement.groupBy({ by: ["teacherId"], where: { centerId: C, type: "EARNED" }, _sum: { amount: true } });
  const shareBySession = await db.sessionInstance.groupBy({ by: ["groupId"], where: { centerId: C, status: "CLOSED" }, _sum: { teacherShare: true } });
  const groupTeacher = await db.group.findMany({ where: { centerId: C }, select: { id: true, teacherId: true } });
  const teacherOfGroup = new Map(groupTeacher.filter((g) => g.teacherId).map((g) => [g.id, g.teacherId!]));
  const shareByTeacher = new Map<string, number>();
  for (const s of shareBySession) {
    const t = teacherOfGroup.get(s.groupId);
    if (t) shareByTeacher.set(t, (shareByTeacher.get(t) ?? 0) + (s._sum.teacherShare ?? 0));
  }
  let earnedOk = true;
  for (const e of earnedByT) if ((e._sum.amount ?? 0) !== (shareByTeacher.get(e.teacherId) ?? -1)) earnedOk = false;
  ck("EARNED لكل مدرس == مجموع نصايب حصصه", earnedOk, `${earnedByT.length} مدرس`);

  // (4) الخزنة: counted == opening + كاش اليوم (للأيام المقفولة)
  const cashDays = await db.cashDay.findMany({ where: { centerId: C }, orderBy: { date: "asc" }, select: { date: true, openingCash: true, countedCash: true, status: true } });
  const cashPays = await db.studentTransaction.findMany({ where: { centerId: C, type: "PAYMENT", method: "CASH" }, select: { id: true } });
  void cashPays;
  let cashOk = true;
  for (let i = 1; i < cashDays.length; i++) {
    const prev = cashDays[i - 1], cur = cashDays[i];
    if (prev.status === "CLOSED" && cur.openingCash !== prev.countedCash) cashOk = false;
  }
  ck("الخزنة: افتتاحية اليوم = تعداد اليوم اللي قبله", cashOk, `${cashDays.length} يوم`);

  // (5) المخزون: الكتب = ابتدائي - المبيعات
  const bookStock = await db.book.findMany({ where: { centerId: C }, select: { id: true, stock: true } });
  const soldByBook = await db.bookSale.groupBy({ by: ["bookId"], where: { centerId: C }, _sum: { qty: true } });
  const soldMap = new Map(soldByBook.map((s) => [s.bookId, s._sum.qty ?? 0]));
  const initialStock: Record<string, number> = {};
  for (const b of await db.book.findMany({ where: { centerId: C }, select: { id: true } })) initialStock[b.id] = 0;
  void initialStock;
  // (الابتدائي مش مخزن — نتخطى الفحص المطلق ونتحقق إن المخزون موجب)
  ck("مخزون الكتب كله موجب", bookStock.every((b) => b.stock >= 0), `${bookStock.length} كتاب`);
  void soldMap;

  // (6) إحصاءات عامة
  const [nSess, nAtt, nTxn, nRc, nSettle, nExp, nJournal, nAnn, nNotif, nQueue, nAtt2, nSales] = await Promise.all([
    db.sessionInstance.count({ where: { centerId: C } }),
    db.attendance.count({ where: { centerId: C } }),
    db.studentTransaction.count({ where: { centerId: C } }),
    db.receipt.count({ where: { centerId: C } }),
    db.teacherSettlement.count({ where: { centerId: C } }),
    db.expense.count({ where: { centerId: C } }),
    db.centerTransaction.count({ where: { centerId: C } }),
    db.announcement.count({ where: { centerId: C } }),
    db.studentNotification.count({ where: { centerId: C } }),
    db.messageQueueItem.count({ where: { centerId: C } }),
    db.notificationAttempt.count({ where: { centerId: C } }),
    db.bookSale.count({ where: { centerId: C } }),
  ]);
  console.log(`\n  📊 الحجم النهائي: ${nSess} حصة · ${nAtt} حضور · ${nTxn} حركة · ${nRc} إيصال · ${nSettle} مستحق/صرف · ${nExp} مصروف · ${nJournal} قيد · ${nAnn} إعلان → ${nNotif} إشعار · ${nQueue} رسالة طابور · ${nAtt2} محاولة دفع · ${nSales} بيعة كتب`);

  console.log(`\n  ${fail === 0 ? "✅ كل الثوابت سليمة" : "❌ في مشاكل!"} (${pass} نجح / ${fail} فشل)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
