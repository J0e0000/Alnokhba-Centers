// E2E إنتاج: مسار ملف الاسترداد كامل — تسجيل الحزمة → معاينة → مزامنة → idempotency → السجل
// بنبني ملف استرداد حقيقي (ETX بمجموع تحقق صحيح) من حزمة نزّلناها من الإنتاج نفسها.
import crypto from "node:crypto";

const BASE = process.env.QAE_BASE || "https://alnokhba-centers-nine.vercel.app";
const PWD = "Qae#2026";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

function canonicalJson(value) {
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = sorted(v[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(sorted(value));
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

async function login(username, password = PWD) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get("set-cookie") ?? "").match(/nokhba_session=[^;]+/)?.[0] ?? "";
}

function extractScript(html, id) {
  const re = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) return null;
  return m[1]; // النص الخام زي ما هو — ده نفسه licenseRaw/snapshotRaw الموقّعين
}

(async () => {
  console.log("=== E2E استرداد الطوارئ على الإنتاج ===");
  const mgr = await login("qae-mgr-99");
  ok("لوجين qae-mgr-99", !!mgr);

  // 1) تصدير حزمة جديدة (ده كمان بيسجل الحزمة في EmergencyPackage دلوقتي)
  const pkgRes = await fetch(`${BASE}/api/emergency?package=1&cb=${Date.now()}`, { headers: { cookie: mgr } });
  const html = await pkgRes.text();
  ok("الحزمة نزلت HTML", pkgRes.status === 200 && html.includes("nk-license-raw"), `status=${pkgRes.status} len=${html.length}`);

  const licenseRaw = extractScript(html, "nk-license-raw");
  const snapshotRaw = extractScript(html, "nk-snapshot-raw");
  const meta = JSON.parse(extractScript(html, "nk-meta"));
  const license = JSON.parse(licenseRaw);
  const snap = JSON.parse(snapshotRaw);
  ok("رخصة + توقيع + لقطة مستخرجة", !!licenseRaw && !!meta?.signature && !!snap?.students?.length,
     `license=${license?.packageId} sig=${String(meta?.signature).slice(0, 12)} students=${snap?.students?.length}`);

  // 2) معاملة دفع اختبارية (25ج) لطالب من اللقطة — من غير balanceBefore عشان ما تحصلش تعارض رصيد
  const student = snap.students.find((s) => s.status !== "ARCHIVED");
  const amount = 2500;
  const txn = {
    id: "ETX-" + crypto.randomUUID(),
    packageId: license.packageId,
    centerId: license.centerId,
    seq: 1,
    ts: new Date().toISOString(),
    actor: "QAE E2E",
    actorId: null,
    actorRole: "MANAGER",
    op: "PAYMENT_RECORDED",
    entityType: "STUDENT",
    entityId: student.id,
    prev: null,
    next: null,
    payload: { amount, paid: amount, method: "CASH", note: "اختبار E2E لمسار الاسترداد", date: new Date().toISOString().slice(0, 10) },
  };
  txn.sum = sha256(canonicalJson(txn));

  const recovery = {
    v: 1,
    typ: "ALNOKHBA_EMERGENCY_RECOVERY",
    centerId: license.centerId,
    centerName: license.centerName,
    packageId: license.packageId,
    snapshotId: license.snapshotId,
    exportedAt: new Date().toISOString(),
    period: { from: license.issuedAt, to: license.expiresAt },
    appVersion: license.appVersion,
    actorNow: "QAE E2E",
    counts: { txns: 1, notes: 0 },
    license: licenseRaw,
    signature: meta.signature,
    txns: [txn],
    integrity: { algo: "SHA-256", field: "sum", note: "E2E", snapshotDigest: license.snapshotDigest },
  };

  const post = async (action, decisions = {}) => {
    const r = await fetch(`${BASE}/api/emergency`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: mgr },
      body: JSON.stringify({ action, recovery, decisions }),
    });
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  };

  // 3) معاينة — المفروض 1 صالحة
  const pv = await post("recovery-preview");
  ok("preview → 200", pv.status === 200, JSON.stringify(pv.data).slice(0, 140));
  ok("preview → معاملة صالحة=1", pv.data?.valid === 1, `valid=${pv.data?.valid} invalid=${pv.data?.invalid} msg=${pv.data?.message}`);

  // 4) مزامنة — المفروض تستورد 1
  const cm = await post("recovery-commit");
  ok("commit → 200", cm.status === 200, JSON.stringify(cm.data).slice(0, 140));
  ok("commit → imported=1", cm.data?.imported === 1, `imported=${cm.data?.imported}`);

  // 5) نفس الملف تاني — idempotency: متكررة مش مستوردة
  const pv2 = await post("recovery-preview");
  ok("إعادة الرفع → duplicates=1 وصلاحية 0", pv2.data?.duplicates === 1 && pv2.data?.valid === 0, `dup=${pv2.data?.duplicates} valid=${pv2.data?.valid}`);

  // 6) عزل وتلاعب — (أ) معاملة لسنتر تاني (ب) مبلغ متعدّل والمجموع قديم
  const mkPkg = (txns) => ({ ...recovery, txns });
  const tForeign = { ...txn, id: "ETX-" + crypto.randomUUID(), centerId: "cmothercenter0000000000000xx" };
  const rF = await fetch(`${BASE}/api/emergency`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: mgr },
    body: JSON.stringify({ action: "recovery-preview", recovery: mkPkg([tForeign]) }),
  });
  const dF = await rF.json().catch(() => null);
  ok("معاملة سنتر تاني → مرفوضة", rF.status === 200 && dF?.valid === 0 && dF?.invalid === 1, `status=${rF.status} valid=${dF?.valid} invalid=${dF?.invalid}`);

  const tTampered = { ...txn, id: "ETX-" + crypto.randomUUID(), payload: { ...txn.payload, amount: 999999 } };
  tTampered.sum = txn.sum; // المجموع القديم مع مبلغ جديد = تلاعب
  const rT = await fetch(`${BASE}/api/emergency`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: mgr },
    body: JSON.stringify({ action: "recovery-preview", recovery: mkPkg([tTampered]) }),
  });
  const dT = await rT.json().catch(() => null);
  ok("معاملة متعدّلة (checksum) → مرفوضة", rT.status === 200 && dT?.valid === 0 && dT?.invalid === 1, `status=${rT.status} valid=${dT?.valid} invalid=${dT?.invalid}`);

  // 7) السجل بقى فيه صف recovery
  const hist = await fetch(`${BASE}/api/emergency`, { headers: { cookie: mgr } });
  const hd = await hist.json();
  const recRow = (hd?.history ?? []).find((h) => h.kind === "recovery");
  ok("سجل المزامنات فيه صف استرداد", !!recRow, JSON.stringify(hd?.history?.slice(0, 2)));

  console.log(`\nالنتيجة: ${pass} صح / ${fail} غلط`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
