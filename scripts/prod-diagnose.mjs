// تشخيص لايف على الإنتاج: صيغ التليفونات المخزنة + مركز الإشعارات + البورتال
const BASE = "https://alnokhba-centers-nine.vercel.app";
let COOKIE = "";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { cookie: COOKIE } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) COOKIE = setCookie.split(";")[0];
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

(async () => {
  // 1) نسخة الكود المنشور
  const health = await api("/api/system/db-status");
  console.log("db-status:", health.status, JSON.stringify(health.body));

  // 2) دخول المدير
  const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
  console.log("login:", login.status, login.body?.user?.name ?? JSON.stringify(login.body).slice(0, 120));
  if (login.status !== 200) return;

  // 3) الطلاب — فحص صيغ التليفونات
  const students = await api("/api/students?page=1&pageSize=50");
  const list = students.body?.students ?? [];
  console.log("students fetched:", list.length, "total:", students.body?.total);
  const phoneLens = {};
  for (const s of list) {
    for (const p of [s.phone, s.parentPhone]) {
      if (!p) continue;
      const key = `${String(p).length}:${String(p)[0]}`;
      phoneLens[key] = (phoneLens[key] || 0) + 1;
    }
  }
  console.log("phone length/first-digit distribution:", JSON.stringify(phoneLens));
  const badPhones = list.filter((s) => (s.phone && !/^01\d{9}$/.test(s.phone)) || (s.parentPhone && !/^01\d{9}$/.test(s.parentPhone)));
  console.log("BAD PHONES (not 01xxxxxxxxx):", JSON.stringify(badPhones.slice(0, 8).map((s) => ({ name: s.name, phone: s.phone, parentPhone: s.parentPhone }))));

  // 4) مركز الإشعارات (staff)
  const notifs = await api("/api/notifications/staff");
  console.log("staff notifs:", notifs.status, "count:", notifs.body?.notifications?.length, "unread:", notifs.body?.unread);
  if (notifs.body?.notifications?.length) {
    console.log("sample:", JSON.stringify(notifs.body.notifications.slice(0, 3), null, 1));
  }

  // 5) إشعارات الطالب (بوابة) — أول طالب
  if (list[0]) {
    const sid = list[0].id;
    const detail = await api(`/api/students/${sid}`);
    const st = detail.body?.student ?? detail.body;
    console.log("first student:", JSON.stringify({ name: st?.name, phone: st?.phone, hasQrToken: !!st?.qrToken }));
  }

  // 6) فحص approvals (تفاصيل طلب)
  const approvals = await api("/api/approvals");
  console.log("approvals:", approvals.status, "pending:", approvals.body?.pending?.length ?? Object.keys(approvals.body ?? {}).slice(0, 6));
})().catch((e) => console.error("FATAL:", e.message));
