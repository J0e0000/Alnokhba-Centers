// تحقق نهائي على الإنتاج بعد نشر FIX-4 (a2d4404)
const BASE = "https://alnokhba-centers-nine.vercel.app";

async function api(path, opts = {}, cookieJar = { c: "" }) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookieJar.c ? { cookie: cookieJar.c } : {}), ...(opts.headers || {}) },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookieJar.c = sc.split(";")[0];
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

(async () => {
  // 0) علامة النشر: بلوك جديد غير موجود في القديم
  const home = await fetch(BASE + "/portal").then((r) => r.text()).catch(() => "");
  console.log("portal page fetched:", home.length > 1000 ? "OK" : "SHORT");

  // 1) دخول مدير
  const jar = { c: "" };
  const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) }, jar);
  console.log("manager login:", login.status);

  // 2) أول طالب نشط → code + phone
  const students = await api("/api/students?page=1&pageSize=3&status=ACTIVE", {}, jar);
  const s0 = students.body?.students?.[0];
  if (!s0) { console.log("NO STUDENT"); return; }
  const detail = await api(`/api/students/${s0.id}`, {}, jar);
  const st = detail.body?.student ?? detail.body;
  const phone = st.phone || st.parentPhone;
  console.log("test student:", st.name, "| code:", st.code, "| phone:", phone);

  // 3) دخول البورتال بالرقم من غير الصفر (الكيس المكسور قبل الإصلاح)
  const noZero = phone.replace(/^0/, "");
  const variants = [phone, noZero, "+2" + phone, "+20" + phone.slice(1)];
  let allOk = true;
  for (const v of variants) {
    const r = await api("/api/portal", { method: "POST", body: JSON.stringify({ action: "login", code: st.code, phone: v }) }, { c: "" });
    console.log(`portal login phone='${v}' → ${r.status} ${r.body?.ok ? "ok:true" : (r.body?.error || "").slice(0, 50)}`);
    if (r.status !== 200) allOk = false;
  }
  console.log(allOk ? "✅ كل صيغ الرقم بتدخل" : "❌ فيه صيغة فاشلة");

  // 4) مركز الإشعارات
  const notifs = await api("/api/notifications/staff", {}, jar);
  console.log("staff notifs:", notifs.status, "| count:", notifs.body?.notifications?.length, "| unread:", notifs.body?.unread);
  const hasDetails = (notifs.body?.notifications ?? []).every((n) => typeof n.body === "string" && n.title);
  console.log("notifications all have title+body (details data):", hasDetails ? "✅" : "❌");
})().catch((e) => console.error("FATAL:", e.message));
