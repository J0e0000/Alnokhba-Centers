/**
 * probe_old_db.ts — read-only inspection of the old Supabase Postgres.
 * Reuses the migrate script's throwaway-pg-client pattern.
 * NEVER writes. Prints table list + row counts for our known models.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = '/home/z/my-project'
const PG_SCHEMA_SRC = path.join(ROOT, 'prisma', 'schema.postgres.prisma')
const PG_SCHEMA_TMP = path.join(ROOT, 'prisma', '.schema.pg-probe.prisma')
const PG_CLIENT_DIR = path.join(ROOT, 'generated', 'prisma-pg')

const pgUrl = process.argv[2] || ''
if (!pgUrl.startsWith('postgres')) {
  console.error('✖ pass the postgres URL as argv[2]')
  process.exit(1)
}

async function main() {
  // 1) temp client (only regenerate if missing)
  if (!fs.existsSync(path.join(PG_CLIENT_DIR, 'index.js'))) {
    const schema = fs.readFileSync(PG_SCHEMA_SRC, 'utf8').replace(
      /generator\s+client\s*\{[^}]*\}/,
      `generator client {\n  provider = "prisma-client-js"\n  output   = "../generated/prisma-pg"\n}`
    )
    fs.writeFileSync(PG_SCHEMA_TMP, schema)
    console.log('· generating throwaway pg client…')
    execSync(`npx prisma generate --schema="${PG_SCHEMA_TMP}"`, { cwd: ROOT, stdio: 'inherit' })
  }
  process.env.NK_PG_URL = pgUrl
  const { PrismaClient: PgClient } = await import(path.join(PG_CLIENT_DIR, 'index.js'))
  const pg = new PgClient({ datasources: { db: { url: pgUrl } } })

  // 2) enumerate our models dynamically from the pg client
  const models = Object.keys(pg).filter((k) => /^[a-z][A-Za-z]+$/.test(k) && typeof (pg as any)[k]?.findMany === 'function' && (pg as any)[k]?.count)
  const skip = new Set(['$connect', '$disconnect', '$on', '$transaction', '$use', '$extends', '$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe', '$namingExtension'])
  const interesting = models.filter((m) => !skip.has(m) && !m.startsWith('_'))

  console.log(`· probing ${interesting.length} models from schema.postgres.prisma…\n`)
  const rows: Array<[string, number]> = []
  for (const m of interesting) {
    try {
      const c = await (pg as any)[m].count()
      rows.push([m, c])
    } catch {
      rows.push([m, -1]) // table missing
    }
  }
  rows.sort((a, b) => (a[1] === -1 ? 1 : b[1] === -1 ? -1 : b[1] - a[1]))
  for (const [m, c] of rows) console.log(`  ${c === -1 ? '✖ table missing ' : String(c).padStart(7)}  ${m}`)

  // 3) identity peek: centers + users (names only, no secrets)
  try {
    const centers = await (pg as any).center.findMany({ select: { slug: true, name: true }, take: 10 })
    console.log('\ncenters:', JSON.stringify(centers))
    const users = await (pg as any).user.findMany({ select: { username: true, role: true }, take: 40 })
    console.log('users:', JSON.stringify(users))
    const att = await (pg as any).attendance?.count?.().catch(() => 'n/a')
    console.log('attendance rows:', att)
  } catch (e) {
    console.log('identity peek failed:', (e as Error).message.slice(0, 200))
  }
  await pg.$disconnect()
}

main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(2) })
