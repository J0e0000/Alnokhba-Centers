/** يولّد 60 حساب موظف اختبار [LT] لقياس login تحت الحمل — scrypt زي النظام بالظبط */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

async function main() {
  const center = await db.center.findFirst()
  const existing = await db.user.count({ where: { username: { startsWith: 'ltuser' } } })
  if (existing === 0) {
    for (let i = 0; i < 60; i++) {
      await db.user.create({
        data: {
          centerId: center!.id,
          username: `ltuser${i}`,
          passwordHash: hashPassword('nokhba123'),
          name: `موظف حمل ${i} [LT]`,
          role: 'RECEPTIONIST',
        },
      })
    }
  }
  console.log('lt users:', await db.user.count({ where: { username: { startsWith: 'ltuser' } } }))
}

main().finally(() => db.$disconnect())
