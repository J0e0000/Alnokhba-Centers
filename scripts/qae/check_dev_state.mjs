// فحص سريع لحالة الداتا المحلية — المراكز والأعداد اللي البنش هيشتغل عليها
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  const centers = await db.center.findMany({ select: { id: true, name: true, slug: true }, take: 20 });
  console.log("CENTERS:", JSON.stringify(centers, null, 1));
  const users = await db.user.findMany({ where: { username: { startsWith: "qae" } }, select: { username: true, role: true, centerId: true }, take: 10 });
  console.log("QAE USERS:", JSON.stringify(users, null, 1));
  const c = centers[0];
  if (c) {
    const [students, sessions, att, txns, receipts, expenses, settlements, books, groups, slots] = await Promise.all([
      db.student.count({ where: { centerId: c.id } }),
      db.sessionInstance.count({ where: { centerId: c.id } }),
      db.attendance.count({ where: { session: { centerId: c.id } } }),
      db.studentTransaction.count({ where: { centerId: c.id } }),
      db.receipt.count({ where: { centerId: c.id } }),
      db.expense.count({ where: { centerId: c.id } }),
      db.teacherSettlement.count({ where: { centerId: c.id } }),
      db.bookSale.count({ where: { centerId: c.id } }),
      db.group.count({ where: { centerId: c.id } }),
      db.scheduleSlot.count({ where: { centerId: c.id } }),
    ]);
    console.log(`CENTER[0] ${c.slug}: students=${students} sessions=${sessions} att=${att} txns=${txns} receipts=${receipts} expenses=${expenses} settlements=${settlements} bookSales=${books} groups=${groups} slots=${slots}`);
    const lastSession = await db.sessionInstance.findFirst({ where: { centerId: c.id }, orderBy: { date: "desc" }, select: { date: true, status: true } });
    console.log("lastSession:", lastSession);
  }
} finally { await db.$disconnect(); }
