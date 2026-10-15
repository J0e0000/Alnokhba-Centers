// فحص تفصيلي للباك أب: السنترز + خطط الاشتراك + كروت الطلاب
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const centers = await db.center.findMany({
  select: { id: true, slug: true, name: true, status: true },
});
console.log('=== CENTERS IN BACKUP ===');
for (const c of centers) {
  const students = await db.student.count({ where: { centerId: c.id } });
  const users = await db.user.count({ where: { centerId: c.id } });
  console.log(`${c.slug} | ${c.name} | status=${c.status} | students=${students} | users=${users}`);
}

const subs = await db.$queryRawUnsafe(`SELECT s.id, c.slug, s.status, s.paymentStatus, p.name as planName, p.maxStudents FROM Subscription s JOIN Center c ON c.id = s.centerId JOIN SubscriptionPlan p ON p.id = s.planId LIMIT 10`);
console.log('=== SUBSCRIPTIONS ===', JSON.stringify(subs, null, 1));

// Students per QAE center breakdown
const qae = centers.find((c) => c.slug === 'qae-c99-stress');
if (qae) {
  const active = await db.student.count({ where: { centerId: qae.id, status: 'ACTIVE' } });
  const archived = await db.student.count({ where: { centerId: qae.id, status: 'ARCHIVED' } });
  console.log('QAE students: active=', active, 'archived=', archived);
  const groups = await db.group.count({ where: { centerId: qae.id } });
  const payments = await db.$queryRawUnsafe(`SELECT COUNT(*) as n FROM Payment WHERE centerId = '${qae.id}'`);
  console.log('QAE groups=', groups, 'payments=', JSON.stringify(payments));
}

await db.$disconnect();
