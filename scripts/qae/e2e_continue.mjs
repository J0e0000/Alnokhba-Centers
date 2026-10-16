// E2E: login to prod app as qae-mgr-99 and verify the center is alive
const BASE = 'https://alnokhba-centers-nine.vercel.app';
const jar = '/tmp/nk_e2e_cookies.txt';

async function hit(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

// 1) login
const login = await hit('/api/auth', { method: 'POST', body: { username: 'qae-mgr-99', password: 'Qae#2026' } });
console.log('login status:', login.status);
const cookie = (login.setCookie ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith('nokhba_session')).join('; ');
if (!cookie) { console.log('NO COOKIE — abort'); process.exit(1); }

// 2) tomorrow's sessions visible as OPEN
const s = await hit('/api/sessions?date=2026-10-17', { cookie });
const sess = s.data?.sessions ?? [];
console.log('\nsessions 2026-10-17:', sess.length, '| statuses:', [...new Set(sess.map((x) => x.status ?? (x.closed ? 'CLOSED' : 'OPEN')))].join(','), '| first:', sess[0]?.groupName ?? sess[0]?.group?.name ?? '?', sess[0]?.startTime);

// 3) today's TOPUP flow visible (reports / recent txns)
const rep = await hit('/api/reports?type=daily-collections&from=2026-10-16&to=2026-10-16', { cookie });
console.log('daily-collections status:', rep.status, '| sample:', JSON.stringify(rep.data).slice(0, 200));

// 4) Zaki rules engine alive
const z = await hit('/api/zaki', { cookie });
const findings = z.data?.findings ?? z.data ?? [];
console.log('\nzaki findings:', Array.isArray(findings) ? findings.length : typeof findings, '| first:', Array.isArray(findings) && findings[0] ? (findings[0].key ?? findings[0].type ?? '?') : JSON.stringify(findings).slice(0, 120));

// 5) Zaki free question about today's collections (deterministic brain)
const zb = await hit('/api/zaki', { method: 'POST', body: { q: 'collections' }, cookie });
console.log('zaki collections preset:', zb.status, JSON.stringify(zb.data).slice(0, 300));
