// فتح حصتين النهاردة في الديف — لاختبار التوجيه التلقائي مع أكتر من حصة شغالة
const BASE = "http://localhost:3000";
const login = await fetch(`${BASE}/api/auth`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "qae-rec-99", password: "Qae#2026" }),
});
const setCookie = login.headers.getSetCookie?.() ?? [];
const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
console.log("login:", login.status, cookie ? "cookie ✓" : "NO COOKIE");

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const t = await fetch(`${BASE}/api/today`, { headers: { cookie } }).then((r) => r.json());
console.log("today api:", t.date, "suggestions:", t.suggestions?.length ?? 0);

const opened = [];
for (const s of (t.suggestions ?? []).slice(0, 2)) {
  const r = await fetch(`${BASE}/api/sessions`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ scheduleId: s.scheduleId, date: today }),
  });
  const d = await r.json().catch(() => ({}));
  console.log("open:", s.subject ?? s.name, "→", r.status, d.session?.id ?? JSON.stringify(d).slice(0, 120));
  if (d.session?.id) opened.push(d.session.id);
}
console.log("opened:", opened.length ? opened.join(", ") : "none");

// طالبين من مجموعتي الحصص المفتوحة للاختبار
const sess = await fetch(`${BASE}/api/sessions?date=${today}`, { headers: { cookie } }).then((r) => r.json());
for (const s of sess.sessions ?? []) {
  const det = await fetch(`${BASE}/api/sessions/${s.id}`, { headers: { cookie } }).then((r) => r.json());
  const first = (det.absent ?? [])[0] ?? (det.attendance ?? [])[0] ?? null;
  console.log(`session ${s.id.slice(-6)} ${s.subject ?? s.name} ${s.status}: roster=${(det.absent?.length ?? 0) + (det.attendance?.length ?? 0)} first=${first ? `${first.code} ${first.name}` : "—"}`);
}
