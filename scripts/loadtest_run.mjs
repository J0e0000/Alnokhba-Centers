/**
 * LOAD TEST RUNNER — local production build (port 3000)
 * scenarios: staff login | dashboard | students search | payment | portal login | full exam flow
 * concurrency: 1, 5, 10, 25, 50 — reports p50/p95/p99, req/s, errors
 */
const BASE = process.env.LT_BASE ?? 'http://localhost:3001'
const MANAGER = { username: 'manager', password: 'nokhba123' }
const GROUP_ID = 'cmufickaj001aiqo936zozyx0'

// ---------- helpers ----------
function randXff() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
}

async function hit(path, { method = 'GET', body, cookie, xff } = {}) {
  const t0 = performance.now()
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        'x-forwarded-for': xff ?? randXff(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const setCookie = res.headers.getSetCookie?.() ?? []
    const ms = performance.now() - t0
    let data = null
    try { data = await res.json() } catch { /* ignore */ }
    return { ms, status: res.status, data, setCookie }
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, data: null, error: String(e).slice(0, 80) }
  }
}

function cookieFrom(setCookies, name) {
  for (const c of setCookies ?? []) {
    const [pair] = c.split(';')
    if (pair.startsWith(name + '=')) return pair
  }
  return null
}

function pct(arr, p) {
  const a = [...arr].sort((x, y) => x - y)
  const i = Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)
  return a[Math.max(0, i)]
}

async function runScenario(name, conc, total, fn) {
  const latencies = []
  let errors = 0
  const t0 = performance.now()
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= total) return
      const r = await fn(i)
      latencies.push(r.ms)
      if (r.status === 0 || r.status >= 400) errors++
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  const wall = (performance.now() - t0) / 1000
  return {
    scenario: name, conc, total,
    p50: Math.round(pct(latencies, 50)),
    p95: Math.round(pct(latencies, 95)),
    p99: Math.round(pct(latencies, 99)),
    rps: +(total / wall).toFixed(1),
    errors,
  }
}

// ---------- session prep ----------
async function staffCookie() {
  const r = await hit('/api/auth', { method: 'POST', body: MANAGER, xff: '10.0.0.1' })
  const c = cookieFrom(r.setCookie, 'nokhba_session')
  if (!c) throw new Error('staff login failed: ' + JSON.stringify(r.data))
  return c
}

async function portalCookie(code, phone) {
  const r = await hit('/api/portal', { method: 'POST', body: { action: 'login', code, phone } })
  const c = cookieFrom(r.setCookie, 'nokhba_portal')
  if (!c) throw new Error(`portal login failed ${code}: ` + JSON.stringify(r.data))
  return c
}

// ---------- main ----------
async function main() {
  const rows = []
  let flowN = 0 // عدّاد عالمي عشان أزواج (طالب، امتحان) تفضل فريدة بين الجولات

  // lazily fetch lists used by scenarios
  const staffC = await staffCookie()

  // students list for payments (grab 200 synthetic student ids)
  const stuPage = await hit('/api/students?q=طالب اختبار حمل&pageSize=50', { cookie: staffC })
  const studentIds = (stuPage.data?.students ?? []).map((s) => s.id)
  console.error('payment pool:', studentIds.length)

  // portal-capable synthetic students (code+phone) — from DB via search by phone prefix 0157
  // simpler: use fixed known range codes 30000-30499 with phone 0157xxxxxxx (same mapping as gen)
  const portalPool = Array.from({ length: 2000 }, (_, i) => ({
    code: String(30000 + i),
    phone: `0157${String(1000000 + i).slice(-7)}`,
  }))

  // exams list for exam flow (first 100 published LT exams)
  // teacher session to list exams scoped to group — but simpler: staff /api/exams
  const exList = await hit('/api/exams', { cookie: staffC })
  const examIds = (exList.data?.exams ?? []).filter((e) => e.title.includes('[LT]')).map((e) => e.id)
  console.error('exam pool:', examIds.length)

  // ============ SCENARIOS ============
  // LT_GROUP=light → التدفقات الخفيفة | LT_GROUP=heavy → الداشبورد (استعلامات تقيلة)
  const group = process.env.LT_GROUP ?? 'light'
  const dashFns = group === 'heavy' ? [1, 5, 10, 15] : []
  const scenarios = [
    {
      name: 'staff-login',
      fns: [1, 5, 10],
      // staff login rate-limited per username → 60 حساب ltuser — بيلف عليهم
      run: async (i) => hit('/api/auth', { method: 'POST', body: { username: `ltuser${i % 60}`, password: 'nokhba123' } }),
    },
    {
      name: 'dashboard',
      fns: dashFns,
      run: async () => hit('/api/dashboard', { cookie: staffC }),
    },
    {
      name: 'students-search-5000',
      fns: [1, 5, 10, 25, 50],
      run: async () => hit('/api/students?q=طالب اختبار حمل&page=1&pageSize=24', { cookie: staffC }),
    },
  ].filter((s) => s.fns.length > 0)

  const restScenarios = [
    {
      name: 'payment-write',
      fns: [1, 5, 10, 25, 50],
      run: async (i) => hit('/api/payments', {
        method: 'POST', cookie: staffC,
        body: { studentId: studentIds[i % studentIds.length], amount: 50 + (i % 10), method: 'CASH' },
      }),
    },
    {
      name: 'portal-login',
      fns: [1, 5, 10, 25, 50],
      run: async (i) => hit('/api/portal', { method: 'POST', body: { action: 'login', code: portalPool[i % portalPool.length].code, phone: portalPool[i % portalPool.length].phone } }),
    },
    {
      name: 'exam-full-flow',
      fns: [1, 5, 10, 25, 50],
      run: async () => {
        const k = flowN++ // فريد عالميًا عبر كل الجولات
        const st = portalPool[k % portalPool.length]
        const login = await hit('/api/portal', { method: 'POST', body: { action: 'login', code: st.code, phone: st.phone } })
        const pc = cookieFrom(login.setCookie, 'nokhba_portal')
        if (!pc) return { ms: login.ms, status: 500 }
        const examId = examIds[k % examIds.length]
        const t0 = performance.now()
        const start = await hit(`/api/portal/exams/${examId}`, { method: 'POST', body: { action: 'start' }, cookie: pc })
        if (start.status >= 400) return { ms: performance.now() - t0, status: start.status, data: start.data }
        const q = await hit(`/api/portal/exams/${examId}`, { cookie: pc })
        const qs = q.data?.questions ?? []
        for (const question of qs) {
          const ans = question.type === 'MCQ' ? '0' : question.type === 'TRUE_FALSE' ? 'true' : '42'
          await hit(`/api/portal/exams/${examId}`, { method: 'POST', body: { action: 'answer', questionId: question.id, answer: ans }, cookie: pc })
        }
        const sub = await hit(`/api/portal/exams/${examId}`, { method: 'POST', body: { action: 'submit' }, cookie: pc })
        return { ms: performance.now() - t0, status: sub.status, data: sub.data }
      },
    },
  ]

  for (const sc of [...scenarios, ...restScenarios]) {
    for (const conc of sc.fns) {
      const total = Math.max(conc * 4, sc.name === 'staff-login' ? 60 : 20)
      // portal attempts unique: portalPool 2000 students × examIds 100 → max 200k pairs; sequential i ensures uniqueness mostly
      const r = await runScenario(sc.name, conc, total, sc.run)
      rows.push(r)
      console.log(JSON.stringify(r))
      await new Promise((res) => setTimeout(res, 1500)) // cool-down between runs
    }
  }

  console.log('\n=== SUMMARY TABLE ===')
  console.log('scenario            | conc |  p50 |  p95 |  p99 | req/s | err')
  for (const r of rows) {
    console.log(
      `${r.scenario.padEnd(19)} | ${String(r.conc).padStart(4)} | ${String(r.p50).padStart(4)} | ${String(r.p95).padStart(4)} | ${String(r.p99).padStart(4)} | ${String(r.rps).padStart(5)} | ${r.errors}`
    )
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
