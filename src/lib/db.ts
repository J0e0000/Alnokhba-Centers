import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

// Deploy-safe fallback: if DATABASE_URL is not set, resolve the committed demo
// database instead of crashing. On serverless (Vercel) the bundle filesystem is
// read-only, so copy the sqlite file to /tmp first — everything works, with
// ephemeral writes, until a real DATABASE_URL (postgres) is configured.
if (!process.env.DATABASE_URL) {
  const candidates = [
    path.join(process.cwd(), 'db', 'custom.db'),
    path.join(process.cwd(), '..', 'db', 'custom.db'),
    path.join(process.cwd(), '..', '..', 'db', 'custom.db')
  ]
  const bundled = candidates.find((p) => fs.existsSync(p))
  if (process.env.VERCEL === '1' && bundled) {
    const tmpDb = '/tmp/nokhba-demo.db'
    try {
      if (!fs.existsSync(tmpDb)) fs.copyFileSync(bundled, tmpDb)
      process.env.DATABASE_URL = 'file:' + tmpDb
    } catch {
      process.env.DATABASE_URL = 'file:' + bundled
    }
  } else {
    process.env.DATABASE_URL = 'file:' + (bundled ?? path.join(process.cwd(), 'db', 'custom.db'))
  }
}

// ============================================================
// توسعة قاعدة البيانات (Task R) — ضبط الاتصال حسب نوع الداتابيز:
// - Postgres مُدار: connection_limit افتراضي آمن لكل lambda (بيمنع استنزاف
//   اتصالات الداتابيز لما موجة طلبة تمسح في نفس الثانية) + pool_timeout.
//   يتعاد الضبط بمتغير البيئة NK_DB_CONNECTION_LIMIT من غير deploy جديد.
// - SQLite (تطوير/اختبار): journal_mode=WAL — القراءات مش بتحجب الكاتب
//   والعكس (الوضع دايم على مستوى ملف الداتابيز — تنفيذ واحد كفاية).
// ============================================================
if (process.env.DATABASE_URL.startsWith('postgres')) {
  try {
    const u = new URL(process.env.DATABASE_URL)
    if (!u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', process.env.NK_DB_CONNECTION_LIMIT ?? '10')
    }
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '15')
    process.env.DATABASE_URL = u.toString()
  } catch {
    // URL غير قياسي — سيبه زي ما هو
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

// SQLite WAL (توسعة Task R) — mode دايم على مستوى الملف؛ تنفيذ أول تشغيل كفاية
// (فشل صامت لو الملف مقفول من عملية تانية — المرة الجاية هيتم)
if (process.env.DATABASE_URL.startsWith('file:')) {
  db.$queryRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {})
}

// Cache on EVERY environment (incl. production): Next.js bundles this module
// into each route's serverless bundle — without globalThis caching, every
// route in a lambda instance would spin its own PrismaClient + engine,
// wasting CPU (slow cold start) and connections.
globalForPrisma.prisma = db