import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

// TEMPORARY diagnostic route — reveals what the serverless runtime actually
// sees. Safe: exposes no secrets (DB URL prefix only, no credentials).
export async function GET() {
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
  return NextResponse.json({
    cwd: process.cwd(),
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelFlag: process.env.VERCEL || null,
    envSet: !!process.env.DATABASE_URL,
    dbUrlPrefix: (process.env.DATABASE_URL || '').slice(0, 24),
    exists,
    tmpCopyOk: tmpOk,
    lsDb,
    lsRoot: fs.readdirSync(process.cwd()).slice(0, 50),
  })
}
