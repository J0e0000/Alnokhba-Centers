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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

// Cache on EVERY environment (incl. production): Next.js bundles this module
// into each route's serverless bundle — without globalThis caching, every
// route in a lambda instance would spin its own PrismaClient + engine,
// wasting CPU (slow cold start) and connections.
globalForPrisma.prisma = db