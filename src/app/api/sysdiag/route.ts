import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdmin, ApiError } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// TEMPORARY diagnostic route — admin-only. Reveals what the serverless runtime
// actually sees. Safe: exposes no secrets (DB URL prefix only, no credentials).
// Schema probe: detects drift between deployed code and DB columns/tables
// (SubscriptionPlan.features / TrustedDeviceBinding) — the exact failure that
// 500'd every entitlement route when db push didn't apply on deploy.
export async function GET() {
  try {
    await requireAdmin()
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 401
    return NextResponse.json({ error: e instanceof Error ? e.message : 'لازم تسجل دخول الأول.' }, { status })
  }

  const cands = [
    path.join(process.cwd(), 'db', 'custom.db'),
    path.join(process.cwd(), '..', 'db', 'custom.db'),
    path.join(process.cwd(), '..', '..', 'db', 'custom.db'),
  ]
  const exists = cands.map((p) => ({ p: '…' + p.slice(-45), ok: fs.existsSync(p) }))
  let tmpOk: unknown = null
  try {
    const bundled = cands.find((p) => fs.existsSync(p))
    if (bundled) {
      fs.copyFileSync(bundled, '/tmp/diag.db')
      tmpOk = fs.existsSync('/tmp/diag.db')
    } else {
      tmpOk = 'no bundled db found'
    }
  } catch (e) {
    tmpOk = 'ERR: ' + (e as Error).message
  }
  let lsDb: string[] | string = 'no db dir'
  try {
    lsDb = fs.readdirSync(path.join(process.cwd(), 'db'))
  } catch (e) {
    lsDb = 'readdir err: ' + (e as Error).message
  }

  // Schema drift probe (postgres only — sqlite has no information_schema)
  let schema: unknown = null
  try {
    const planCols = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'SubscriptionPlan'`,
    )
    const tabs = await db.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('TrustedDeviceBinding','AgentUsage','CenterCapability')`,
    )
    schema = {
      planColumns: planCols.map((c) => c.column_name),
      tables: tabs.map((t) => t.table_name),
      featuresSynced: planCols.some((c) => c.column_name === 'features'),
      trustedDevicesSynced: tabs.some((t) => t.table_name === 'TrustedDeviceBinding'),
    }
  } catch (e) {
    schema = { error: (e as Error).message }
  }

  // PERF probe: زمن استعلام حقيقي من جوه الـ lambda (يحدد لو الـ DB قريب من iad1 ولا بعيد)
  let dbPing: unknown = null
  try {
    const t: number[] = []
    for (let i = 0; i < 4; i++) {
      const s = Date.now()
      await db.$queryRawUnsafe('SELECT 1')
      t.push(Date.now() - s)
    }
    dbPing = { seqMs: t, avgMs: Math.round(t.reduce((a, b) => a + b, 0) / t.length) }
  } catch (e) {
    dbPing = { error: (e as Error).message }
  }

  return NextResponse.json({
    cwd: process.cwd(),
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelFlag: process.env.VERCEL || null,
    envSet: !!process.env.DATABASE_URL,
    dbUrlPrefix: (process.env.DATABASE_URL || '').slice(0, 24),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    exists,
    tmpCopyOk: tmpOk,
    lsDb,
    lsRoot: fs.readdirSync(process.cwd()).slice(0, 50),
    schema,
    dbPing,
  })
}
