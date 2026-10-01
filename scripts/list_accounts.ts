import { PrismaClient } from '@prisma/client'
import { scryptSync, timingSafeEqual } from 'crypto'

const db = new PrismaClient()

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split(':')
    if (scheme !== 'scrypt' || !salt || !hash) return false
    const candidate = scryptSync(password, salt, 64)
    const expected = Buffer.from(hash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

// candidate passwords seen in seeds / prior verified logins
const CANDIDATES = ['nokhba123', 'academia123', 'manager2', 'reception2']

async function main() {
  const centers = await db.center.findMany({ select: { id: true, name: true } })
  const cName = (id: string | null) =>
    id ? (centers.find((c) => c.id === id)?.name ?? '(unknown center)') : '(platform)'

  const users = await db.user.findMany({
    select: { username: true, name: true, role: true, centerId: true, isActive: true, scope: true, passwordHash: true },
    orderBy: [{ centerId: 'asc' }, { role: 'asc' }],
  })

  console.log('=== STAFF ACCOUNTS ===')
  for (const u of users) {
    let ok: string | null = null
    for (const p of CANDIDATES) {
      if (verifyPassword(p, u.passwordHash)) { ok = p; break }
    }
    // also try username as password
    if (!ok && verifyPassword(u.username, u.passwordHash)) ok = u.username
    console.log(
      `${u.username} | pw=${ok ?? 'NOT-IDENTIFIED'} | role=${u.role} | center=${cName(u.centerId)} | active=${u.isActive} | scope=${u.scope}`
    )
  }

  const students = await db.student.findMany({
    select: { code: true, name: true, phone: true, status: true, centerId: true },
    orderBy: { code: 'asc' },
  })
  const portalAble = students.filter((s) => s.phone && s.status === 'ACTIVE')
  console.log(`\n=== STUDENTS === total=${students.length} | active+phone(portal login possible)=${portalAble.length}`)
  for (const s of portalAble) {
    console.log(`${s.code} | ${s.name} | phone=${s.phone} | center=${cName(s.centerId)}`)
  }
  const noPhone = students.filter((s) => !s.phone)
  if (noPhone.length) {
    console.log(`\n-- students WITHOUT phone (cannot log into portal): ${noPhone.length}`)
    for (const s of noPhone.slice(0, 10)) console.log(`   ${s.code} | ${s.name}`)
  }
}

main().finally(() => db.$disconnect())
