/** تشخيص: ليه الدفعة فشلت + ترتيب طلاب الديمو + شكل استجابة /api/students/[id] */
const BASE = "http://localhost:3000";

async function main() {
  const mres = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "nokhba123" }),
  });
  const mcookie = (mres.headers.get("set-cookie") ?? "").split(";")[0];

  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 900));
  await fetch(`${BASE}/api/demo`, { method: "POST", headers: { Cookie: mcookie } });
  await new Promise((r) => setTimeout(r, 1200));

  const demoInfo = await (await fetch(`${BASE}/api/demo`, { headers: { Cookie: mcookie } })).json();
  console.log("demo students:", JSON.stringify(demoInfo.students?.slice(0, 8), null, 1));

  const st = demoInfo.students?.find((s: { balance: number }) => s.balance < 0) ?? demoInfo.students?.[0];
  console.log("\ndebtor:", st?.name, st?.code, st?.balance, st?.id);

  // جرب الدفع وشوف الرد الخام
  const payRes = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mcookie },
    body: JSON.stringify({ studentId: st.id, amount: 10, method: "CASH", type: "PAYMENT" }),
  });
  console.log("\npayment status:", payRes.status);
  console.log("payment body:", JSON.stringify(await payRes.json(), null, 1).slice(0, 500));

  // شكل students/[id]
  const stRes = await fetch(`${BASE}/api/students/${st.id}`, { headers: { Cookie: mcookie } });
  const stBody = await stRes.json();
  console.log("\nstudents/[id] keys:", Object.keys(stBody).join(", "));
  console.log("balance:", stBody.balance);

  // sessions النهاردة
  const sessRes = await (await fetch(`${BASE}/api/sessions`, { headers: { Cookie: mcookie } })).json();
  console.log("\nsessions:", JSON.stringify((sessRes.sessions ?? []).map((s: { id: string; status: string; subject: string }) => ({ id: s.id.slice(-6), status: s.status, subject: s.subject })), null, 1));

  // cleanup
  await fetch(`${BASE}/api/demo?confirm=demo`, { method: "DELETE", headers: { Cookie: mcookie } });
  console.log("\ncleaned");
}

main().catch((e) => console.error(e));
