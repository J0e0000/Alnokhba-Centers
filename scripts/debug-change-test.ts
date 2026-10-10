// Debug: replicate test-change-and-notifs API flow step by step
const BASE = "http://localhost:3000";
const mres = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "manager", password: "nokhba123" }),
});
const mcookie = (mres.headers.get("set-cookie") ?? "").split(";")[0];
console.log("manager login:", mcookie.length > 0);

const del = await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
console.log("demo delete:", del.status, (await del.text()).slice(0, 200));
await new Promise((r) => setTimeout(r, 900));
const post = await fetch(`${BASE}/api/demo`, { method: "POST", headers: { Cookie: mcookie } });
console.log("demo post:", post.status, (await post.text()).slice(0, 300));
await new Promise((r) => setTimeout(r, 1500));

const demoInfo = await (await fetch(`${BASE}/api/demo`, { headers: { Cookie: mcookie } })).json();
console.log("demo students:", (demoInfo.students ?? []).length);
console.log(JSON.stringify((demoInfo.students ?? []).slice(0, 4), null, 1));

// lookup one code
if (demoInfo.students?.length) {
  const code = demoInfo.students[0].code;
  const one = await (await fetch(`${BASE}/api/lookup?q=${code}`, { headers: { Cookie: mcookie } })).json();
  console.log(`lookup ${code}:`, JSON.stringify(one.students?.slice(0, 2) ?? one).slice(0, 300));
}

const sessRes = await (await fetch(`${BASE}/api/sessions`, { headers: { Cookie: mcookie } })).json();
console.log("sessions today:", (sessRes.sessions ?? []).length, JSON.stringify((sessRes.sessions ?? []).slice(0, 3).map(s => ({ subject: s.subject, status: s.status, date: s.date })), null, 1));
