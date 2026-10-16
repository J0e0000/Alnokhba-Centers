// Zaki verification with real keys + free Arabic text + real-centers-untouched check
const BASE = 'https://alnokhba-centers-nine.vercel.app';

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

const login = await hit('/api/auth', { method: 'POST', body: { username: 'qae-mgr-99', password: 'Qae#2026' } });
const cookie = (login.setCookie ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith('nokhba_session')).join('; ');

// exact preset: today's collection
const t = await hit('/api/zaki', { method: 'POST', body: { q: 'today_collection' }, cookie });
console.log('today_collection:', t.status, JSON.stringify(t.data?.title ?? ''), '|', JSON.stringify(t.data?.body ?? '').slice(0, 180));

// fuzzy free-form Arabic (resolveZakiKey should guess → today_collection or debtors)
const f = await hit('/api/zaki', { method: 'POST', body: { text: 'تحصيل النهاردة كان عامل ايه بس' }, cookie });
console.log('fuzzy free-form:', f.status, JSON.stringify(f.data?.key ?? ''), '|', JSON.stringify(f.data?.title ?? ''));

// open_sessions preset (should show tomorrow's 10 OPEN)
const o = await hit('/api/zaki', { method: 'POST', body: { q: 'open_sessions' }, cookie });
console.log('open_sessions:', o.status, JSON.stringify(o.data?.body ?? '').slice(0, 200));
