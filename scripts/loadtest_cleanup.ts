/** مسح داتا اختبار الحمل [LT] — students (كاسكيد للكل حاجة مربوطة) + exams + ltusers */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.time('cleanup')
  const ex = await db.exam.deleteMany({ where: { title: { contains: '[LT]' } } })
  const st = await db.student.deleteMany({ where: { school: 'مدرسة الحمل' } })
  const us = await db.user.deleteMany({ where: { username: { startsWith: 'ltuser' } } })
  const tx = await db.studentTransaction.deleteMany({ where: { reason: 'load-test [LT]' } })
  const at = await db.examAttempt.deleteMany({ where: { student: { school: 'مدرسة الحمل' } } })
  console.log(JSON.stringify({ exams: ex.count, students: st.count, users: us.count, txns: tx.count, orphanAttempts: at.count }))
  console.timeEnd('cleanup')
  const [s, e, t] = await Promise.all([db.student.count(), db.exam.count(), db.studentTransaction.count()])
  console.log({ remainingStudents: s, remainingExams: e, remainingTxns: t })
}

main().finally(() => db.$disconnect())
