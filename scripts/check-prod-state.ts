/** فحص سريع لحالة سنتر الإنتاج بعد التشغيلات — جلسات النهاردة / استيرادات / حملات / حركات */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const center = await db.center.findUniqueOrThrow({ where: { slug: "alnokhba-elite" }, select: { id: true, name: true } });

  const [sessions, imports, atts, txns, students] = await Promise.all([
    db.sessionInstance.findMany({ where: { centerId: center.id, date: today }, select: { id: true, startTime: true, status: true, presentCount: true } }),
    db.emergencyImport.findMany({ where: { centerId: center.id }, select: { id: true, createdAt: true, totalRows: true, imported: true, duplicates: true } }),
    db.attendance.count({ where: { centerId: center.id, session: { date: today } } }),
    db.studentTransaction.count({ where: { centerId: center.id, createdAt: { gte: new Date(Date.now() - 4 * 3600_000) } } }),
    db.student.count({ where: { centerId: center.id } }),
  ]);

  console.log("السنتر:", center.name, "| النهاردة (القاهرة):", today);
  console.log("حصص النهاردة:", sessions.length ? JSON.stringify(sessions) : "صفر ✓");
  console.log("استيرادات الطوارئ:", imports.length ? JSON.stringify(imports) : "صفر ✓");
  console.log("حضور النهاردة:", atts, "| حركات آخر 4 ساعات:", txns, "| إجمالي الطلاب:", students);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
