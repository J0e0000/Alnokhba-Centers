/**
 * SEED ZAKI BENCH ENV — تجهيز بيئة c99 الاختبارية لبانش زكي (داتا اختبار قابلة للرمي)
 * يضيف: حصص مفتوحة فاتت + مدفوعات/إيصالات موزعة زمنيًا (أسبوع حالي ضعيف → قاعدة التحصيل تشتعل)
 *       + مصروفات + مستحقات مدرسين + كتب ومبيعات + اختلال حضور مجموعات + طلاب صفر حضور
 * ⚠️ بيشتغل على سنتر qae-c99-stress الاختباري في الداتابيز المحلية فقط — ممنوع أي لمسة لبيانات حقيقية.
 * Run: bun scripts/qae/seed_zaki_env.mjs
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", dateStyle: "short" }).format(new Date());
function dayOffset(n) { const d = new Date(Date.now() + n * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", dateStyle: "short" }).format(d); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }

const center = await db.center.findUnique({ where: { slug: "qae-c99-stress" }, select: { id: true, name: true } });
if (!center) { console.error("لا يوجد سنتر qae-c99-stress"); process.exit(1); }
const centerId = center.id;
const mgr = await db.user.findFirst({ where: { centerId, role: "MANAGER" }, select: { id: true, name: true } });
console.log(`center=${center.name} (${centerId}) mgr=${mgr?.name}`);

const today = cairoToday();
let created = {};

/* ============ 1) حصص مفتوحة فاتت (قاعدة unclosed_sessions) ============ */
{
  const groups = await db.group.findMany({ where: { centerId, isActive: true }, select: { id: true, sessionPrice: true, teacherPercent: true, room: true }, take: 8 });
  const dates = [dayOffset(-6), dayOffset(-5), dayOffset(-4), dayOffset(-3), dayOffset(-2), dayOffset(-3), dayOffset(-2), dayOffset(-4)];
  const rows = groups.map((g, i) => ({
    centerId, groupId: g.id, date: dates[i], startTime: "10:00", endTime: "12:00",
    room: g.room ?? "QAE", price: g.sessionPrice, teacherPercent: g.teacherPercent,
    status: "OPEN", name: "حصة QAE مفتوحة", openedBy: mgr?.id,
  }));
  const res = await db.sessionInstance.createMany({ data: rows });
  created.openSessions = res.count;
}

/* ============ 2) مدفوعات + إيصالات (التحصيل + الأرصدة) ============ */
{
  const students = await db.student.findMany({ where: { centerId, status: "ACTIVE" }, select: { id: true }, take: 1200 });
  const balances = await db.studentTransaction.groupBy({ by: ["studentId"], where: { centerId, studentId: { in: students.map((s) => s.id) } }, _sum: { amount: true } });
  const balMap = new Map(balances.map((b) => [b.studentId, b._sum.amount ?? 0]));

  const payments = [];
  // 680 دفعة في الفترة 35-8 يوم (قاعدة ثقيلة) + 16 دفعة في آخر 7 أيام (أسبوع ضعيف → collection_anomaly)
  for (let i = 0; i < 680; i++) {
    const day = dayOffset(-rand(8, 35));
    payments.push({ studentId: pick(students).id, day, amount: rand(10000, 45000), method: pick(["CASH", "CASH", "VODAFONE", "INSTAPAY"]) });
  }
  for (let i = 0; i < 16; i++) {
    payments.push({ studentId: pick(students).id, day: dayOffset(-rand(0, 6)), amount: rand(5000, 15000), method: "CASH" });
  }
  payments.sort((a, b) => (a.day < b.day ? -1 : 1));

  const lastSeq = (await db.receipt.aggregate({ where: { centerId }, _max: { seq: true } }))._max.seq ?? 0;
  let seq = lastSeq;
  const txnRows = [], receiptRows = [];
  for (const p of payments) {
    const before = balMap.get(p.studentId) ?? 0;
    const after = before + p.amount;
    balMap.set(p.studentId, after);
    const createdAt = new Date(`${p.day}T${String(rand(10, 19)).padStart(2, "0")}:${String(rand(0, 59)).padStart(2, "0")}:00`);
    const txnId = `qae-txn-${seq + 1}`;
    txnRows.push({ id: txnId, centerId, studentId: p.studentId, type: "PAYMENT", amount: p.amount, method: p.method, reason: "دفعة QAE", createdBy: mgr?.id ?? "qae", createdAt });
    seq += 1;
    receiptRows.push({
      centerId, seq, number: `RC-${String(seq).padStart(6, "0")}`, txnId, studentId: p.studentId,
      amount: p.amount, method: p.method, balanceBefore: before, balanceAfter: after, sessionId: null,
      issuedBy: mgr?.id ?? "qae", issuedByName: mgr?.name ?? "QAE", date: p.day, createdAt,
    });
  }
  // DB SQLite: createMany في معاملة واحدة — على دفعات عشان حدود SQLite
  for (let i = 0; i < txnRows.length; i += 200) {
    await db.studentTransaction.createMany({ data: txnRows.slice(i, i + 200) });
    await db.receipt.createMany({ data: receiptRows.slice(i, i + 200) });
  }
  created.payments = txnRows.length; created.receipts = receiptRows.length;
}

/* ============ 3) مصروفات ============ */
{
  const cats = ["RENT", "ELECTRICITY", "SALARIES", "MAINTENANCE", "SUPPLIES", "OTHER"];
  const amounts = { RENT: [250000, 350000], ELECTRICITY: [40000, 90000], SALARIES: [100000, 220000], MAINTENANCE: [20000, 60000], SUPPLIES: [10000, 35000], OTHER: [5000, 20000] };
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const c = cats[i % cats.length];
    rows.push({ centerId, category: c, amount: rand(...amounts[c]), date: dayOffset(-rand(1, 28)), note: "مصروف QAE", createdBy: mgr?.id ?? "qae" });
  }
  await db.expense.createMany({ data: rows });
  created.expenses = rows.length;
}

/* ============ 4) مستحقات المدرسين ============ */
{
  const teachers = await db.teacher.findMany({ where: { centerId }, select: { id: true }, take: 30 });
  const rows = [];
  for (const t of teachers) {
    const e1 = rand(8000, 30000), e2 = rand(8000, 30000);
    rows.push({ centerId, teacherId: t.id, type: "EARNED", amount: e1, date: dayOffset(-rand(10, 25)), note: "مستحق QAE", createdBy: mgr?.id ?? "qae" });
    rows.push({ centerId, teacherId: t.id, type: "EARNED", amount: e2, date: dayOffset(-rand(5, 9)), note: "مستحق QAE", createdBy: mgr?.id ?? "qae" });
    rows.push({ centerId, teacherId: t.id, type: "PAID", amount: -Math.round((e1 + e2) / 2), date: dayOffset(-rand(2, 4)), note: "صرف QAE", createdBy: mgr?.id ?? "qae" });
  }
  await db.teacherSettlement.createMany({ data: rows });
  created.settlements = rows.length;
}

/* ============ 5) كتب + مبيعات ============ */
{
  const bookNames = ["كتاب QAE رياضيات", "كتاب QAE فيزياء", "كتاب QAE كيمياء", "كتاب QAE عربي", "كتاب QAE إنجليزي", "كتاب QAE دراسات"];
  const books = [];
  for (const name of bookNames) {
    const existing = await db.book.findFirst({ where: { centerId, name } });
    if (existing) { books.push(existing); continue; }
    const price = rand(15000, 45000);
    books.push(await db.book.create({ data: { centerId, name, price, costPrice: Math.round(price * 0.6), stock: 200 } }));
  }
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const b = pick(books);
    const qty = rand(1, 2);
    rows.push({ centerId, bookId: b.id, studentId: null, buyerName: `زبون QAE ${i + 1}`, qty, unitPrice: b.price, unitCost: b.costPrice, total: qty * b.price, method: "CASH", date: dayOffset(-rand(0, 28)), createdBy: mgr?.id ?? "qae" });
  }
  await db.bookSale.createMany({ data: rows });
  created.books = books.length; created.bookSales = rows.length;
}

/* ============ 6) اختلال حضور 3 مجموعات (قاعدة group_att_drop) ============ */
{
  const groups = await db.group.findMany({ where: { centerId, isActive: true }, select: { id: true }, take: 3, orderBy: { id: "asc" } });
  const from14 = dayOffset(-14);
  const sids = await db.sessionInstance.findMany({ where: { centerId, groupId: { in: groups.map((g) => g.id) }, date: { gte: from14 }, status: { not: "CANCELLED" } }, select: { id: true } });
  const marks = await db.attendance.findMany({ where: { sessionId: { in: sids.map((s) => s.id) }, status: { in: ["PRESENT", "LATE"] } }, select: { id: true } });
  const toAbsent = marks.filter(() => Math.random() < 0.62).map((m) => m.id);
  await db.attendance.updateMany({ where: { id: { in: toAbsent } }, data: { status: "ABSENT" } });
  created.attDropGroups = groups.length; created.flippedToAbsent = toAbsent.length;
}

/* ============ 7) 45 طالب بصفر حضور (قاعدة repeated_absence) ============ */
{
  const regs = await db.studentGroup.findMany({ where: { status: "ACTIVE", group: { centerId, isActive: true } }, select: { studentId: true }, take: 3000 });
  const ids = [...new Set(regs.map((r) => r.studentId))].slice(0, 45);
  const res = await db.attendance.deleteMany({ where: { studentId: { in: ids }, session: { centerId } } });
  created.zeroAttStudents = ids.length; created.deletedMarks = res.count;
}

console.log("SEED DONE:", JSON.stringify(created, null, 1));
await db.$disconnect();
