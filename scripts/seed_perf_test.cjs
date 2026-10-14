#!/usr/bin/env node
/* زرع بيانات اختبار أداء مصغرة — idempotent (upsert) — محلي فقط */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const H = require('./hash_helper.cjs').hashPassword('nokhba123');
  let center = await p.center.findUnique({ where: { slug: 'perf-test' } });
  if (!center) center = await p.center.create({ data: { name: 'سنتر أداء اختباري', slug: 'perf-test', status: 'ACTIVE' } });
  const cid = center.id;
  const mgr = await p.user.upsert({
    where: { username: 'perf_mgr' },
    update: { passwordHash: H, role: 'MANAGER' },
    create: { username: 'perf_mgr', passwordHash: H, name: 'مدير الأداء', role: 'MANAGER', centerId: cid },
  });
  const g1 = await p.grade.upsert({ where: { centerId_name: { centerId: cid, name: 'الصف الأول الثانوي' } }, update: {}, create: { centerId: cid, name: 'الصف الأول الثانوي' } });
  const s1 = await p.subject.upsert({ where: { centerId_name: { centerId: cid, name: 'رياضة' } }, update: {}, create: { centerId: cid, name: 'رياضة' } });
  let t1 = await p.teacher.findFirst({ where: { centerId: cid, name: 'أ. محمود' } });
  if (!t1) t1 = await p.teacher.create({ data: { centerId: cid, name: 'أ. محمود', phone: '01000000001' } });
  let gr = await p.group.findFirst({ where: { centerId: cid, name: 'أ' } });
  if (!gr) gr = await p.group.create({ data: { centerId: cid, name: 'أ', gradeId: g1.id, subjectId: s1.id, teacherId: t1.id, sessionPrice: 5000, teacherPercent: 50 } });
  const room = await p.room.findFirst({ where: { centerId: cid, name: 'قاعة 1' } });
  if (!room) await p.room.create({ data: { centerId: cid, name: 'قاعة 1', order: 1 } });
  const slot = await p.scheduleSlot.findFirst({ where: { centerId: cid, groupId: gr.id, dayOfWeek: 1 } });
  if (!slot) await p.scheduleSlot.create({ data: { centerId: cid, dayOfWeek: 1, startTime: '16:00', endTime: '18:00', groupId: gr.id, room: 'قاعة 1' } });
  for (let i = 1; i <= 8; i++) {
    let st = await p.student.findFirst({ where: { centerId: cid, code: '1000' + i } });
    if (!st) st = await p.student.create({ data: { centerId: cid, name: 'طالب اختبار رقم ' + i, code: '1000' + i, phone: '0100000000' + i, parentPhone: '0110000000' + i, gradeId: g1.id, status: 'ACTIVE', qrToken: 'perfqr' + Math.random().toString(36).slice(2, 12) } });
    const reg = await p.studentGroup.findFirst({ where: { studentId: st.id, groupId: gr.id } });
    if (!reg) await p.studentGroup.create({ data: { studentId: st.id, groupId: gr.id, status: "ACTIVE" } });
    const tx = await p.studentTransaction.findFirst({ where: { centerId: cid, studentId: st.id, type: 'PAYMENT' } });
    if (!tx) await p.studentTransaction.create({ data: { centerId: cid, studentId: st.id, type: 'PAYMENT', amount: 3000, reason: 'دفعة اختبار الأداء', createdBy: mgr.id } });
  }
  console.log('SEEDED OK — center:', cid);
}

main().catch((e) => { console.error('SEED_FAIL_CODE:', e && e.code, '| TAIL:', JSON.stringify(String(e && e.message)).slice(-260)); process.exit(1); }).finally(() => p.$disconnect());
