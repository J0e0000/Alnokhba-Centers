/** Debug: reproduce emergency preview and print conflict reasons */
import ExcelJS from "exceljs";

const BASE = "http://localhost:3000";
let cookies = "";

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(cookies ? { Cookie: cookies } : {}), ...(opts.headers ?? {}) },
  });
  const setc = res.headers.getSetCookie?.() ?? [];
  if (setc.length) cookies = setc.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function postForm(path, form) {
  const res = await fetch(BASE + path, { method: "POST", headers: { Cookie: cookies }, body: form });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  await j("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });

  const dl = await fetch(`${BASE}/api/emergency?export=1`, { headers: { Cookie: cookies } });
  const buf = Buffer.from(await dl.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const wsOps = wb.getWorksheet("عمليات الطوارئ");
  const wsW = wb.getWorksheet("حصص الأسبوع");

  // same modifications as the test
  wsOps.getRow(5).getCell(4).value = 99999;
  wsOps.getRow(5).getCell(6).value = "دفع";
  wsOps.getRow(5).getCell(10).value = 10;
  wsOps.getRow(9).getCell(4).value = 10002;
  wsOps.getRow(9).getCell(6).value = "دفع";
  wsOps.getRow(9).getCell(10).value = 10;
  wsOps.getRow(9).getCell(3).value = "25:99";

  // week sheet rows: dump status + date + open/close col values
  console.log("=== week sheet rows (first 40) ===");
  for (const row of wsW.getRows(2, 40) ?? []) {
    const date = String(row.getCell(2).value ?? "");
    const subject = String(row.getCell(4).value ?? "").slice(0, 18);
    const status = String(row.getCell(8).value ?? "");
    const btn = String(row.getCell(9).value ?? "");
    if (date) console.log(`${date} | ${subject.padEnd(18)} | ${status.padEnd(12)} | btn=${btn}`);
  }

  const cairo = new Date(Date.now() + 2 * 3600 * 1000);
  const today = cairo.toISOString().slice(0, 10);

  const futureRow = (wsW.getRows(2, 200) ?? []).find((row) => String(row.getCell(2).value ?? "") > today && !String(row.getCell(9).value ?? ""));
  if (futureRow) futureRow.getCell(9).value = "قفل";
  const closedRow = (wsW.getRows(2, 200) ?? []).find((row) => String(row.getCell(2).value) === today && String(row.getCell(8).value ?? "") === "مقفولة ✓");
  console.log("\nclosedRow found for today:", Boolean(closedRow));
  if (closedRow) closedRow.getCell(9).value = "فتح";

  const modBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const form = new FormData();
  form.append("file", new Blob([modBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "debug.xlsx");
  form.append("action", "preview");
  const r = await postForm("/api/emergency", form);
  console.log("\n=== preview result ===");
  console.log("valid:", r.data?.valid, "| conflicts:", r.data?.conflicts, "| duplicates:", r.data?.duplicates);
  for (const c of r.data?.preview?.conflicts ?? []) console.log("CONFLICT:", c.reason);
  for (const v of (r.data?.preview?.valid ?? []).slice(0, 10)) console.log("VALID:", JSON.stringify(v).slice(0, 120));
  await j("/api/auth", { method: "DELETE" });
})().catch((e) => { console.error("CRASH:", e.message); process.exit(1); });
