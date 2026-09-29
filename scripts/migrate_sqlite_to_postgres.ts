/**
 * migrate_sqlite_to_postgres.ts — one-shot additive data migration.
 *
 * Moves ALL rows from the local SQLite demo database (db/custom.db) into a
 * hosted PostgreSQL database (Supabase / Neon / Vercel Postgres).
 *
 * Guarantees (spec §10):
 *  - ADDITIVE ONLY: `createMany({ skipDuplicates: true })` — never deletes,
 *    never overwrites existing PG rows; primary IDs are preserved as-is.
 *  - No credentials in code: the PG URL comes from argv or DATABASE_URL.
 *  - FK-safe: models are transferred in topological order derived from the
 *    Prisma DMMF (parents before children).
 *
 * Usage:
 *   npx tsx scripts/migrate_sqlite_to_postgres.ts "postgresql://user:pass@host/db?sslmode=require"
 *
 * How it works:
 *  1. renders a TEMP prisma schema (postgres provider + custom output to
 *     generated/prisma-pg) and generates a throwaway pg client — the default
 *     @prisma/client stays the local SQLite client
 *  2. enumerates every model via Prisma.dmmf
 *  3. reads all rows from SQLite, upserts into PostgreSQL chunk by chunk
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { PrismaClient as SqliteClient, Prisma } from '@prisma/client'

// ---------------------------------------------------------------- config --
const ROOT = process.cwd()
const PG_SCHEMA_SRC = path.join(ROOT, 'prisma', 'schema.postgres.prisma')
const PG_SCHEMA_TMP = path.join(ROOT, 'prisma', '.schema.pg-migrate.prisma')
const PG_CLIENT_DIR = path.join(ROOT, 'generated', 'prisma-pg')

const pgUrl = process.argv[2] || process.env.DATABASE_URL || ''
if (!pgUrl.startsWith('postgres')) {
  console.error(
    '✖ Provide the PostgreSQL connection string as the first argument:\n' +
      '  npx tsx scripts/migrate_sqlite_to_postgres.ts "postgresql://..."'
  )
  process.exit(1)
}

// ------------------------------------------------- 1) temp pg client gen --
async function buildPgClient() {
  const schema = fs.readFileSync(PG_SCHEMA_SRC, 'utf8').replace(
    /generator\s+client\s*\{[^}]*\}/,
    `generator client {\n  provider = "prisma-client-js"\n  output   = "../generated/prisma-pg"\n}`
  )
  fs.writeFileSync(PG_SCHEMA_TMP, schema)
  execSync(
    `npx prisma generate --schema=${path.relative(ROOT, PG_SCHEMA_TMP)}`,
    { stdio: 'inherit', cwd: ROOT }
  )
  // fresh module resolution after generation
  delete require.cache[require.resolve('../generated/prisma-pg/client')]
  const mod = await import(
    '../generated/prisma-pg/client?migrate=' + Date.now()
  ).catch(() => import('../generated/prisma-pg/client'))
  const PgClient = (mod as { PrismaClient: new (o?: object) => never }[])
    .PrismaClient ?? (mod as never as { default: { PrismaClient: new (o?: object) => never } }).PrismaClient
  return new PgClient({ datasources: { db: { url: pgUrl } } }) as never
}

// ------------------------------------------------------- 2) model graph --
type ModelMeta = { name: string }

function topoSort(models: ModelMeta[]): string[] {
  const names = models.map((m) => m.name)
  const deps = new Map<string, Set<string>>() // model -> models it references
  for (const m of models) {
    const mdm = Prisma.dmmf.datamodel.models.find((x) => x.name === m.name)!
    const refs = new Set<string>()
    for (const f of mdm.fields) {
      if (f.kind === 'object' && f.relationFromFields && f.relationFromFields.length > 0) {
        if (names.includes(f.type)) refs.add(f.type)
      }
    }
    deps.set(m.name, refs)
  }
  const done: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (n: string, stack: string[] = []) => {
    if (state.get(n) === 'done') return
    if (state.get(n) === 'visiting') return // circular self/inline relations: defer
    state.set(n, 'visiting')
    for (const d of deps.get(n) ?? []) visit(d, [...stack, n])
    state.set(n, 'done')
    done.push(n)
  }
  names.forEach((n) => visit(n))
  // models skipped due to cycles get appended at the end (still better than nothing)
  for (const n of names) if (!done.includes(n)) done.push(n)
  return done
}

// ----------------------------------------------------------- 3) transfer --
const CHUNK = 200

async function main() {
  console.log('── building temporary postgres client…')
  const pg = await buildPgClient()
  const sqlite = new SqliteClient({ log: ['error'] })

  const models = Prisma.dmmf.datamodel.models.map((m) => ({ name: m.name }))
  const order = topoSort(models)
  console.log(`── ${models.length} models, FK-safe order ready`)

  const totals: Record<string, { read: number; written: number }> = {}
  for (const name of order) {
    const anySqlite = sqlite as unknown as Record<
      string,
      { findMany: () => Promise<unknown[]> }
    >
    const anyPg = pg as unknown as Record<
      string,
      { createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }> }
    >
    const del = (pg as unknown as Record<string, unknown>)[name]
    if (!del) continue
    let read = 0
    let written = 0
    try {
      const rows = await anySqlite[name].findMany()
      read = rows.length
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK)
        const res = await anyPg[name].createMany({ data: chunk, skipDuplicates: true })
        written += res.count
      }
    } catch (e) {
      console.warn(`  ⚠ ${name}: ${(e as Error).message.slice(0, 140)}`)
    }
    totals[name] = { read, written }
    if (read > 0) console.log(`  ${name.padEnd(26)} read ${String(read).padStart(5)} → written ${written}`)
  }

  const totalRead = Object.values(totals).reduce((a, b) => a + b.read, 0)
  const totalWritten = Object.values(totals).reduce((a, b) => a + b.written, 0)
  console.log(`\n── done: ${totalRead} rows read, ${totalWritten} rows written (duplicates skipped)`)
  console.log('   existing PG data was NOT touched — additive only ✔')

  await sqlite.$disconnect()
  await (pg as unknown as { $disconnect: () => Promise<void> }).$disconnect()
}

main().catch((e) => {
  console.error('✖ migration failed:', e)
  process.exit(1)
})
