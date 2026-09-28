import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

// Deploy-safe fallback: if DATABASE_URL is not set (e.g. .env not copied into
// the deploy sandbox), resolve the committed demo database instead of crashing
// at client initialization. Covers both `next dev` (cwd = project root) and
// standalone production (cwd = .next/standalone) layouts.
if (!process.env.DATABASE_URL) {
  const candidates = [
    path.join(process.cwd(), 'db', 'custom.db'),            // dev / project root
    path.join(process.cwd(), 'db', 'custom.db'),            // standalone (db copied by build)
    path.join(process.cwd(), '..', 'db', 'custom.db'),      // one level up
    path.join(process.cwd(), '..', '..', 'db', 'custom.db') // two levels up
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  process.env.DATABASE_URL = 'file:' + (found ?? candidates[0])
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db