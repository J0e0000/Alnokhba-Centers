// تحليل c99: إيه اللي هيشتعل (fire) في قواعد زكي + إيه الناقص — قبل ما نبني البنش
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const centerId = "cmv954yva0000vaz8mm8ibkwq";
try {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", dateStyle: "short" }).format(new Date());
  console.log("today(Cairo):", today);

  const [openPast, payments, books, bookCount] = await Promise.all([
    db.sessionInstance.count({ where: { centerId, status: "OPEN", date: { lt: today } } }),
    db.studentTransaction.count({ where: { centerId, type: "PAYMENT" } }),
    db.bookSale.count({ where: { centerId } }),
    db.book.count({ where: { centerId } }),
  ]);
  console.log("openPastSessions:", openPast, "| PAYMENT txns:", payments, "| bookSales:", books, "| Book records:", bookCount);

  // المديونين
  const debtors = await db.$queryRawUnsafe(`SELECT COUNT(*) n FROM StudentTransaction WHERE centerId = ? GROUP BY studentId HAVING SUM(amount) < 0`, centerId);
  console.log("debtorsCount:", debtors.length);

  // طلاب نشطوا بدون أي حضور آخر 30 يوم (قاعدة repeated_absence)
  const from30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const zeroAtt = await db.$queryRawUnsafe(`
    SELECT COUNT(*) n FROM Student s WHERE s.centerId = ? AND s.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM StudentGroup sg WHERE sg.studentId = s.id AND sg.status = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM Attendance a JOIN SessionInstance si ON si.id = a.sessionId
                      WHERE a.studentId = s.id AND si.date >= ? AND a.status = 'PRESENT')`, centerId, from30);
  console.log("zero-attendance active students (30d):", zeroAtt[0].n);

  // نسبة الحضور (صيغة GT: att / (sess × regs))
  const regs = await db.$queryRawUnsafe(`SELECT COUNT(*) n FROM StudentGroup sg JOIN Student s ON s.id = sg.studentId WHERE sg.status='ACTIVE' AND s.status='ACTIVE' AND s.centerId = ?`, centerId);
  const sess = await db.$queryRawUnsafe(`SELECT COUNT(*) n FROM SessionInstance WHERE centerId = ? AND status != 'CANCELLED' AND date >= ? AND groupId IS NOT NULL`, centerId, from30);
  const att = await db.$queryRawUnsafe(`SELECT COUNT(*) n FROM Attendance a JOIN SessionInstance si ON si.id = a.sessionId WHERE si.centerId = ? AND si.date >= ?`, centerId, from30);
  const exp = Number(sess[0].n) * Number(regs[0].n);
  console.log(`attendanceRate(GT): ${(Number(att[0].n) / exp * 100).toFixed(1)}% (att=${att[0].n}, sess=${sess[0].n}, regs=${regs[0].n})`);

  // توزيع الحضور لكل مجموعة (أعلى/أقل) — صيغة GT
  const groups = await db.$queryRawUnsafe(`
    SELECT g.id, subj.name subject, g.name,
      (SELECT COUNT(*) FROM SessionInstance si WHERE si.groupId = g.id AND si.status != 'CANCELLED' AND si.date >= ?) sess,
      (SELECT COUNT(*) FROM StudentGroup sg JOIN Student st ON st.id = sg.studentId WHERE sg.groupId = g.id AND sg.status='ACTIVE' AND st.status='ACTIVE') regs,
      (SELECT COUNT(*) FROM Attendance a JOIN SessionInstance si2 ON si2.id = a.sessionId WHERE si2.groupId = g.id AND si2.date >= ?) att
    FROM [Group] g JOIN Subject subj ON subj.id = g.subjectId WHERE g.centerId = ?`, from30, from30, centerId);
  const rates = groups.map(r => ({ name: `${r.subject} (${r.name})`, rate: Number(r.sess) * Number(r.regs) > 0 ? Number(r.att) / (Number(r.sess) * Number(r.regs)) : 1 }));
  rates.sort((a, b) => a.rate - b.rate);
  console.log("worst group:", rates[0], "| best:", rates[rates.length - 1]);

  // فجوة القواعد: group_att_drop — آخر 14 يوم مقابل الـ 14 قبلها لكل مجموعة
  const from14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const recentSess = await db.$queryRawUnsafe(`SELECT groupId, COUNT(*) n FROM SessionInstance WHERE centerId = ? AND status != 'CANCELLED' AND date >= ? AND groupId IS NOT NULL GROUP BY groupId`, centerId, from14);
  console.log("groups with sessions in last 14d:", recentSess.length, "/", 30);

  // التحصيل الأسبوع مقابل الشهر (قاعدة collection_anomaly)
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const d35 = new Date(Date.now() - 35 * 86400000).toISOString();
  const week = await db.$queryRawUnsafe(`SELECT COALESCE(SUM(amount),0) s FROM StudentTransaction WHERE centerId = ? AND type='PAYMENT' AND createdAt >= ?`, centerId, d7);
  const month = await db.$queryRawUnsafe(`SELECT COALESCE(SUM(amount),0) s FROM StudentTransaction WHERE centerId = ? AND type='PAYMENT' AND createdAt >= ? AND createdAt < ?`, centerId, d35, d7);
  const cur = Number(week[0].s), base = Number(month[0].s) / 4;
  console.log(`collection: week=${cur / 100}ج base/week=${base / 100}ج → anomaly fires: ${base >= 100000 && cur < base * 0.6}`);
} finally { await db.$disconnect(); }
