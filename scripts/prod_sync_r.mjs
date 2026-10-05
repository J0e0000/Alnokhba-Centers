/* مزامنة سكيمة الإنتاج + تحقق — Task R (indexs لمحرك المخاطر) */
const BASE = "https://alnokhba-centers.vercel.app";
let cookie = "";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
if (login.status !== 200) throw new Error(`login failed: ${login.status}`);

const sync = await api("/api/admin/schema-sync", { method: "POST" });
console.log("schema-sync:", JSON.stringify(sync.body, null, 2).slice(0, 600));

// تحقق: الاستعلام على pg_indexes — عبر peek لم يُعد قيودًا؛ نتحقق بأن الاستدعاء التاني idempotent (0 applied أو applied بنجاح)
const sync2 = await api("/api/admin/schema-sync", { method: "POST" });
console.log("idempotent re-run:", JSON.stringify(sync2.body).slice(0, 200));
