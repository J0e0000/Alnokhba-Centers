/**
 * LOAD TEST DATA GENERATOR — local SQLite
 * يولّد: 5000 طالب + 100 امتحان منشور (5 أسئلة MCQ) + تسجيلات المجموعة + 5000 معاملة مالية
 * كل الداتا عليها علامة [LT] عشان نقدر نمسحها بعد الاختبار.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'

const db = new PrismaClient()

async function main() {
  const CENTER = (await db.center.findFirst())!
  const GROUP_ID = 'cmufickaj001aiqo936zozyx0' // مجموعة أ. محمد حسن — فيزياء A
  const N_STUDENTS = 5000
  const N_EXAMS = 100
  const N_TXNS = 5000
  console.log('center:', CENTER.name, CENTER.id)

  // ===== students =====
  console.time('students')
  const existing = await db.student.count({ where: { centerId: CENTER.id, school: 'مدرسة الحمل' } })
  if (existing === 0) {
    const students: { centerId: string; code: string; qrToken: string; name: string; phone: string; status: string; school: string }[] = []
    for (let i = 0; i < N_STUDENTS; i++) {
      const code = String(30000 + i)
      students.push({
        centerId: CENTER.id,
        code,
        qrToken: 'lt-' + randomBytes(16).toString('hex'),
        name: `طالب اختبار حمل ${i + 1} [LT]`,
        phone: `0157${String(1000000 + i).slice(-7)}`,
        status: 'ACTIVE',
        school: 'مدرسة الحمل',
      })
    }
    for (let i = 0; i < students.length; i += 500) {
      await db.student.createMany({ data: students.slice(i, i + 500) })
    }
  }
  console.timeEnd('students')

  const ids = (await db.student.findMany({ where: { centerId: CENTER.id, school: 'مدرسة الحمل' }, select: { id: true } })).map((s) => s.id)
  console.log('created students:', ids.length)

  // ===== registrations =====
  console.time('registrations')
  const regs = ids.map((studentId) => ({ studentId, groupId: GROUP_ID, status: 'ACTIVE' }))
  for (let i = 0; i < regs.length; i += 500) {
    await db.studentGroup.createMany({ data: regs.slice(i, i + 500) })
  }
  console.timeEnd('registrations')

  // ===== exams (5 MCQ each) =====
  console.time('exams')
  const now = Date.now()
  for (let e = 0; e < N_EXAMS; e++) {
    const questions = Array.from({ length: 5 }, (_, q) => ({
      order: q,
      text: `سؤال ${q + 1} في امتحان الحمل ${e + 1} [LT]`,
      type: 'MCQ',
      options: JSON.stringify(['الإجابة الأولى', 'الثانية', 'الثالثة', 'الرابعة']),
      correctAnswer: String(q % 4),
      points: 1,
    }))
    await db.exam.create({
      data: {
        centerId: CENTER.id,
        groupId: GROUP_ID,
        title: `امتحان حمل ${e + 1} [LT]`,
        status: 'PUBLISHED',
        startAt: new Date(now - 3600_000),
        endAt: new Date(now + 86400_000),
        durationMin: 60,
        maxScore: 5,
        attemptsAllowed: 1,
        createdById: 'loadtest',
        createdByName: 'Load Test',
        questions: { create: questions },
      },
    })
  }
  console.timeEnd('exams')

  // ===== transactions (CHARGE + PAYMENT mixed) =====
  console.time('transactions')
  const txns = ids.slice(0, N_TXNS).map((studentId, i) => ({
    centerId: CENTER.id,
    studentId,
    type: i % 2 === 0 ? 'CHARGE' : 'PAYMENT',
    amount: i % 2 === 0 ? 50000 : -30000,
    method: i % 2 === 0 ? null : 'CASH',
    createdBy: 'loadtest',
    reason: 'load-test [LT]',
  }))
  for (let i = 0; i < txns.length; i += 500) {
    await db.studentTransaction.createMany({ data: txns.slice(i, i + 500) })
  }
  console.timeEnd('transactions')

  // counts
  const [st, ex, at, tx] = await Promise.all([
    db.student.count({ where: { centerId: CENTER.id } }),
    db.exam.count({ where: { centerId: CENTER.id } }),
    db.examQuestion.count(),
    db.studentTransaction.count({ where: { centerId: CENTER.id } }),
  ])
  console.log(JSON.stringify({ totalStudents: st, totalExams: ex, totalQuestions: at, totalTransactions: tx }))
}

main().finally(() => db.$disconnect())
