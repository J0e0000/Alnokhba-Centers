/**
 * PRODUCTION PROBE — https://alnokhba-centers.vercel.app
 * moderate read-only load: conc 5/10/15 — real-world latency numbers
 * small totals to stay polite with rate limits
 */
const BASE = 'https://alnokhba-centers.vercel.app'

const randXff = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

async function hit(path, { method = 'GET', body, cookie } = {}) {
  const t0 = performance.now()
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), 'x-forwarded-for': randXff() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    })
    const ms = performance.now() - t0
    let data = null
    try { data = await res.json() } catch { /* ignore */ }
    return { ms, status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] }
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, data: null }
  }
}

function cookieFrom(cs, name) {
  for (const c of cs ?? []) {
    const [pair] = c.split(';')
    if (pair.startsWith(name + '=')) return pair
  }
  return null
}

function pct(arr, p) {
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.max(0, Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1))]
}

async function runScenario(name, conc, total, fn) {
  const lat = []
  let errors = 0
  const t0 = performance.now()
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= total) return
      const r = await fn(i)
      lat.push(r.ms)
      if (r.status === 0 || r.status >= 400) errors++
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  const wall = (performance.now() - t0) / 1000
  return { name, conc, total, p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), p99: Math.round(pct(lat, 99)), rps: +(total / wall).toFixed(1), errors }
}

async function main() {
  // 1) prep: staff sessions (rotate 5 real accounts)
  const staffUsers = [
    ['admin', 'nokhba123'], ['manager', 'nokhba123'], ['manager2', 'nokhba123'],
    ['reception', 'nokhba123'], ['teacher1', 'nokhba123'],
  ]
  const staffCookies = []
  for (const [u, p] of staffUsers) {
    const r = await hit('/api/auth', { method: 'POST', body: { username: u, password: p } })
    const c = cookieFrom(r.setCookie, 'nokhba_session')
    if (c) staffCookies.push(c)
    console.error(`login ${u}: ${r.status}`)
  }

  // 2) portal sessions for the 16 real students
  const portalCodes = [
    ['10001', '01055551111'], ['10002', '01055552222'], ['10003', '01055553333'], ['10004', '01055554444'],
    ['10005', '01166667777'], ['10006', '01277778888'], ['10007', '01088889999'], ['10008', '01099990000'],
    ['10009', '01122223333'], ['10010', '01233335555'], ['10011', '01012349876'], ['10012', '01156781234'],
    ['10013', '01298765432'], ['10014', '01087651234'], ['10015', '01123456789'], ['10016', '01234567898'],
  ]
  const portalCookies = []
  for (const [code, phone] of portalCodes) {
    const r = await hit('/api/portal', { method: 'POST', body: { action: 'login', code, phone } })
    const c = cookieFrom(r.setCookie, 'nokhba_portal')
    if (c) portalCookies.push(c)
  }
  console.error(`portal sessions: ${portalCookies.length}/16`)

  const rows = []

  // single-shot latency (cold-ish)
  for (const [label, fn] of [
    ['staff-login (single)', () => hit('/api/auth', { method: 'POST', body: { username: 'reception2', password: 'nokhba123' } })],
    ['dashboard (single)', () => hit('/api/dashboard', { cookie: staffCookies[1] })],
    ['students (single)', () => hit('/api/students?page=1&pageSize=24', { cookie: staffCookies[1] })],
    ['portal-exams (single)', () => hit('/api/portal/exams', { cookie: portalCookies[0] })],
    ['portal-schedule (single)', () => hit('/api/portal/schedule', { cookie: portalCookies[0] })],
    ['staff-exams (single)', () => hit('/api/exams', { cookie: staffCookies[4] })],
  ]) {
    const r = await fn()
    console.log(JSON.stringify({ name: label, conc: 1, total: 1, p50: Math.round(r.ms), p95: Math.round(r.ms), p99: Math.round(r.ms), rps: 0, errors: r.status >= 400 ? 1 : 0 }))
  }

  // concurrent probes
  const probes = [
    { name: 'dashboard @10', conc: 10, total: 30, fn: (i) => hit('/api/dashboard', { cookie: staffCookies[i % staffCookies.length] }) },
    { name: 'students @10', conc: 10, total: 30, fn: (i) => hit('/api/students?page=1&pageSize=24', { cookie: staffCookies[i % staffCookies.length] }) },
    { name: 'portal-exams @10', conc: 10, total: 32, fn: (i) => hit('/api/portal/exams', { cookie: portalCookies[i % portalCookies.length] }) },
    { name: 'portal-schedule @15', conc: 15, total: 45, fn: (i) => hit('/api/portal/schedule', { cookie: portalCookies[i % portalCookies.length] }) },
    { name: 'staff-exams @15', conc: 15, total: 45, fn: (i) => hit('/api/exams', { cookie: staffCookies[i % staffCookies.length] }) },
  ]
  for (const p of probes) {
    const r = await runScenario(p.name, p.conc, p.total, p.fn)
    console.log(JSON.stringify(r))
    await new Promise((res) => setTimeout(res, 2000))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
