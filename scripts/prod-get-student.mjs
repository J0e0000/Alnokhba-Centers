// هات توكن طالب حقيقي من الإنتاج + فحص بياناته للبورتال
const BASE = "https://alnokhba-centers-nine.vercel.app";
let COOKIE = "";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(COOKIE ? { cookie: COOKIE } : {}), ...(opts.headers || {}) },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) COOKIE = sc.split(";")[0];
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

(async () => {
  const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
  if (login.status !== 200) { console.log("LOGIN FAILED", login.status); return; }

  const students = await api("/api/students?page=1&pageSize=5&status=ACTIVE");
  const list = students.body?.students ?? [];
  for (const s of list) {
    const detail = await api(`/api/students/${s.id}`);
    const st = detail.body?.student ?? detail.body;
    console.log(`student: ${st?.name} | qrToken: ${st?.qrToken ? st.qrToken.slice(0, 10) + "..." : "MISSING"} | status: ${st?.status}`);
  }
  const first = list[0];
  if (first) {
    const d = await api(`/api/students/${first.id}`);
    const st = d.body?.student ?? d.body;
    console.log("FULL_TOKEN=" + (st?.qrToken ?? ""));
  }
})().catch((e) => console.error("FATAL:", e.message));
