/**
 * اختبار نظام الطوارئ (Emergency Excel — أسبوع كامل):
 * 1. المدير ينزّل ملف الأسبوع → شيتات كاملة (حصص الأسبوع + الكتب + لوحة الأسبوع)
 * 2. عمليات: حضور + دفع بالوقت + إضافة رصيد + بيع كتاب (طالب + زبون نقدي)
 * 3. زرار الحصة: فتح من شيت «حصص الأسبوع» + القفل بحساباتها (إيراد + نصيب المدرس)
 * 4. Preview → commit → تحقق فعلي في الداتابيز (مخزون الكتب + جلسات + رصيد)
 * 5. إعادة الاستيراد → كل حاجة duplicate (صفر تكرار)
 * npx tsx scripts/test-emergency.ts
 */
import ExcelJS from "exceljs";

const BASE = "http://localhost:3000";
let mcookie = "";
let passed = 0, failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

async function req(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(mcookie ? { Cookie: mcookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) mcookie = setCookie.split(";")[0];
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

async function postForm(path: string, form: FormData) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: mcookie ? { Cookie: mcookie } : {},
    body: form,
  });
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** صيغة الخلية كنص (خلايا الفورميلا بتترجع object) */
function formulaOf(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in (v as Record<string, unknown>)) {
    return String((v as unknown as { formula?: unknown }).formula ?? "");
  }
  return String(v ?? "");
}

async function main() {
  console.log("🧪 اختبار نظام الطوارئ (أسبوع كامل)\n");

  // ============ 0. دخول ============
  let r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" });
  ok("login manager", r.status === 200);

  const lookup = await req("/api/lookup?q=10002");
  const student = ((lookup.data.students as { id: string; code: string; name: string }[]) ?? [])[0];
  ok("student 10002 found", !!student, student?.name);
  const stDetail = await req(`/api/students/${student.id}`);
  const balanceBefore = (stDetail.data.balance as number) ?? 0;
  console.log(`  رصيد 10002 قبل: ${balanceBefore / 100} ج`);

  // ============ 1. تنزيل ملف الأسبوع ============
  console.log("\n— تنزيل ملف الطوارئ (أسبوع) —");
  const dl = await fetch(`${BASE}/api/emergency?export=1`, { headers: mcookie ? { Cookie: mcookie } : {} });
  ok("export returns 200", dl.status === 200);
  ok("content-type is xlsx", (dl.headers.get("content-type") ?? "").includes("spreadsheetml"));
  const buf = Buffer.from(await dl.arrayBuffer());
  ok("file is substantial", buf.length > 8000, `${(buf.length / 1024).toFixed(0)} KB`);

  const rec = await fetch(`${BASE}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "reception", password: "nokhba123" }),
  });
  const recCookie = (rec.headers.get("set-cookie") ?? "").split(";")[0];
  const denied = await fetch(`${BASE}/api/emergency?export=1`, { headers: { Cookie: recCookie } });
  ok("receptionist can't export", denied.status === 403, `status=${denied.status}`);
  await denied.body?.cancel();

  // ============ 2. فحص الشيتات ============
  console.log("\n— فحص شيتات الأسبوع —");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const sheetNames = wb.worksheets.map((w) => w.name);
  ok("instructions sheet", sheetNames.includes("ابدأ من هنا"), sheetNames.join("،"));
  ok("students sheet", sheetNames.includes("الطلاب"));
  ok("groups sheet", sheetNames.includes("المجموعات"));
  ok("week sessions sheet (جديد)", sheetNames.includes("حصص الأسبوع"));
  ok("ops sheet", sheetNames.includes("عمليات الطوارئ"));
  ok("books sheet (بوكشوب)", sheetNames.includes("الكتب"));
  ok("week dashboard sheet", sheetNames.includes("لوحة الأسبوع"));
  ok("today reference sheet", sheetNames.includes("حضور النهاردة"));
  const keysSheet = wb.getWorksheet("المفاتيح");
  ok("keys sheet (hidden)", !!keysSheet);

  const wsSt = wb.getWorksheet("الطلاب")!;
  ok("students rows exported", wsSt.rowCount >= 15, `${wsSt.rowCount} صف`);

  // تاريخ القاهرة زي السيرفر بالظبط — toISOString كان بيعطي UTC وبيكسر الاختبار
  // في نافذة بعد نص ليل القاهرة (21:00–00:00 UTC)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const year = today.slice(0, 4);

  // مخزون الكتب وأسعارها قبل (للرجوع وقت التنضيف)
  const physBefore = await (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const db0 = new PrismaClient();
    const p = await db0.book.findFirst({ where: { name: { contains: "الفيزياء" } }, select: { name: true, stock: true, price: true } });
    const c = await db0.book.findFirst({ where: { name: { contains: "الكيمياء" } }, select: { name: true, stock: true } });
    await db0.$disconnect();
    return { phys: p?.stock ?? 0, chem: c?.stock ?? 0, physPrice: (p?.price ?? 0) / 100 };
  })();

  // ---- شيت حصص الأسبوع: أكواد SES + حالة + زرار ----
  const wsW = wb.getWorksheet("حصص الأسبوع")!;
  ok("week sheet has rows", wsW.rowCount >= 2, `${wsW.rowCount} صف`);
  const firstSes = String(wsW.getRow(2).getCell(1).value ?? "");
  ok("SES codes prefilled", /^SES-\d{3}$/.test(firstSes), firstSes);
  ok("week covers today+", wsW.getRows(2, 50)!.some((row) => String(row.getCell(2).value) === today));
  const futureDates = wsW.getRows(2, 200)!.filter((row) => String(row.getCell(2).value ?? "") > today);
  ok("week covers future days (أسبوع كامل)", futureDates.length > 0, `${futureDates.length} صف مستقبلي`);
  const hasActionDd = wsW.getRows(2, 10)!.some((row) => !!row.getCell(9).dataValidation);
  ok("session action dropdown (زرار فتح/قفل)", hasActionDd);
  const statuses = new Set(wsW.getRows(2, 100)!.map((row) => String(row.getCell(8).value ?? "")));
  ok("session statuses exported", statuses.has("مجدولة") || statuses.has("مفتوحة 🟢") || statuses.has("مقفولة ✓"), [...statuses].slice(0, 4).join(" / "));

  // ---- صف الحصة اللي هنعمل عليه فتح/قفل: النهاردة + مجدولة ----
  const openRow = wsW.getRows(2, 200)!.find((row) =>
    String(row.getCell(2).value) === today && String(row.getCell(8).value ?? "") === "مجدولة",
  );
  ok("found a scheduled session today (لزرار الفتح)", !!openRow, openRow ? String(openRow.getCell(5).value).slice(0, 40) : "");
  const targetGroup = openRow ? String(openRow.getCell(5).value) : "";

  // ---- شيت الكتب ----
  const wsB = wb.getWorksheet("الكتب")!;
  ok("books exported", wsB.rowCount >= 3, `${wsB.rowCount} كتاب`);
  let bookPhysics = "", bookChem = "", bookZeroStock = "";
  for (let i = 2; i <= wsB.rowCount; i++) {
    const name = String(wsB.getRow(i).getCell(1).value ?? "");
    const stock = Number(wsB.getRow(i).getCell(3).value ?? 0);
    if (name.includes("الفيزياء") && !bookPhysics) bookPhysics = name;
    if (name.includes("الكيمياء") && !bookChem) bookChem = name;
    if (stock === 0 && !bookZeroStock) bookZeroStock = name;
  }
  ok("physics book found", !!bookPhysics, bookPhysics.slice(0, 30));
  ok("zero-stock book found (لاختبار التعارض)", !!bookZeroStock, bookZeroStock.slice(0, 30) || "—");

  // ---- شيت العمليات: الأعمدة الجديدة ----
  const wsOps = wb.getWorksheet("عمليات الطوارئ")!;
  ok("ops EMG ids prefilled", String(wsOps.getRow(2).getCell(1).value ?? "").startsWith("EMG-"));
  ok("ops VLOOKUP name formula (col E)", String(wsOps.getRow(2).getCell(5).value ?? "").includes("VLOOKUP") || typeof wsOps.getRow(2).getCell(5).value === "object");
  ok("ops student dropdown (col D)", !!wsOps.getRow(2).getCell(4).dataValidation);
  ok("ops time column present", String(wsOps.getRow(1).getCell(3).value ?? "").includes("الوقت"));
  ok("ops book dropdown (col H)", !!wsOps.getRow(2).getCell(8).dataValidation);
  ok("ops book amount auto-formula", String(wsOps.getRow(2).getCell(10).value ?? "").includes("بيع كتاب") || typeof wsOps.getRow(2).getCell(10).value === "object");
  ok("ops hidden time-normalizer column", typeof wsOps.getRow(2).getCell(13).value === "object");

  // ---- لوحة الأسبوع: فترة الكاش + البوكشوب + الحصص ----
  const wsD = wb.getWorksheet("لوحة الأسبوع")!;
  const dashText = wsD.getRows(1, 30)!.map((row) => row.getCell(1).value ? String(row.getCell(1).value) : "").join(" | ");
  const b4 = String(wsD.getCell("B4").value ?? "");
  const b5 = String(wsD.getCell("B5").value ?? "");
  ok("cash window inputs (من/لوقت)", b4.includes(":") && b5.includes(":"), `${b4} → ${b5}`);
  ok("cash window formula uses SUMIFS", formulaOf(wsD.getCell("B6")).includes("SUMIFS"));
  const f6 = formulaOf(wsD.getCell("B6"));
  ok("cash window filters method+time", f6.includes("دفع") && f6.includes("كاش") && f6.includes("M$"));
  ok("dashboard bookshop section", dashText.includes("البوكشوب"));
  ok("dashboard book revenue formula", formulaOf(wsD.getCell("B20")).includes("بيع كتاب"));
  ok("dashboard sessions section", dashText.includes("الحصص") && formulaOf(wsD.getCell("B23")).includes("فتح") && formulaOf(wsD.getCell("B24")).includes("قفل"));

  // دور على طالب في مجموعة الفيزياء (غير 10002 عشان رصيده يفضل مرجع نظيف للحساب)
  let targetCode = "";
  for (let i = 2; i <= wsSt.rowCount; i++) {
    const groupsStr = String(wsSt.getRow(i).getCell(5).value ?? "");
    const code = String(wsSt.getRow(i).getCell(1).value ?? "");
    if (targetGroup && groupsStr.includes(targetGroup.split(" (")[0]) && code !== "10002") {
      targetCode = code;
      break;
    }
  }
  if (!targetCode) targetCode = String(wsSt.getRow(2).getCell(1).value ?? "");
  console.log(`  الطالب المختار: ${targetCode} في ${targetGroup.slice(0, 45) || "—"}`);

  // ============ 3. تعديل الملف (عمليات + زرار الحصة) ============
  console.log("\n— إضافة عمليات + زرار الحصة —");
  // صف 2: حضور على نفس مجموعة الزرار (هيفتح الحصة تلقائيًا وقت المزامنة)
  wsOps.getRow(2).getCell(4).value = Number(targetCode);
  wsOps.getRow(2).getCell(6).value = "حضور";
  wsOps.getRow(2).getCell(7).value = targetGroup;
  // صف 3: دفع بالوقت (لتتبع فترة الكاش)
  wsOps.getRow(3).getCell(4).value = 10002;
  wsOps.getRow(3).getCell(6).value = "دفع";
  wsOps.getRow(3).getCell(10).value = 77;
  wsOps.getRow(3).getCell(11).value = "كاش";
  wsOps.getRow(3).getCell(3).value = "18:30";
  // صف 4: إضافة رصيد
  wsOps.getRow(4).getCell(4).value = 10002;
  wsOps.getRow(4).getCell(6).value = "إضافة رصيد";
  wsOps.getRow(4).getCell(10).value = 13;
  // صف 5: كود مش موجود → conflict
  wsOps.getRow(5).getCell(4).value = 99999;
  wsOps.getRow(5).getCell(6).value = "دفع";
  wsOps.getRow(5).getCell(10).value = 10;
  // صف 6: بيع كتاب لطالب (السعر بيتحسب من الداتابيز وقت المزامنة)
  wsOps.getRow(6).getCell(4).value = 10002;
  wsOps.getRow(6).getCell(6).value = "بيع كتاب";
  wsOps.getRow(6).getCell(8).value = bookPhysics;
  wsOps.getRow(6).getCell(9).value = 2;
  // صف 7: بيع كتاب لزبون نقدي (بدون كود طالب)
  wsOps.getRow(7).getCell(6).value = "بيع كتاب";
  wsOps.getRow(7).getCell(8).value = bookChem;
  wsOps.getRow(7).getCell(9).value = 1;
  wsOps.getRow(7).getCell(10).value = 90;
  wsOps.getRow(7).getCell(12).value = "زبون";
  // صف 8: كتاب مخزونه صفر → conflict
  if (bookZeroStock) {
    wsOps.getRow(8).getCell(6).value = "بيع كتاب";
    wsOps.getRow(8).getCell(8).value = bookZeroStock;
    wsOps.getRow(8).getCell(9).value = 1;
  }
  // صف 9: وقت غلط → conflict
  wsOps.getRow(9).getCell(4).value = 10002;
  wsOps.getRow(9).getCell(6).value = "دفع";
  wsOps.getRow(9).getCell(10).value = 10;
  wsOps.getRow(9).getCell(3).value = "25:99";

  // زرار الحصة: فتح الحصة المجدولة النهاردة
  if (openRow) {
    openRow.getCell(9).value = "فتح";
  }
  // زرار غلط: قفل على حصة مستقبلية → conflict
  if (futureDates.length > 0) {
    futureDates[0].getCell(9).value = "قفل";
  }
  // زرار غلط: فتح على حصة مقفولة → conflict
  const closedRow = wsW.getRows(2, 200)!.find((row) =>
    String(row.getCell(2).value) === today && String(row.getCell(8).value ?? "") === "مقفولة ✓",
  );
  if (closedRow) closedRow.getCell(9).value = "فتح";

  // عدد التعارضات المتوقع = حسب الصفوف اللي اتظبطت فعلاً
  // (كود غلط + وقت غلط دايمًا · مخزون صفر لو فيه كتاب كده · قفل مستقبلي لو فيه · فتح مقفولة لو فيه حصة مقفولة النهاردة)
  const expectedConflicts = 2
    + (bookZeroStock ? 1 : 0)
    + (futureDates.length > 0 ? 1 : 0)
    + (closedRow ? 1 : 0);

  const modBuf = Buffer.from(await wb.xlsx.writeBuffer());

  // ============ 4. Preview ============
  console.log("\n— Preview —");
  let form = new FormData();
  form.append("file", new Blob([modBuf], { type: XLSX_TYPE }), "emergency-week-test.xlsx");
  form.append("action", "preview");
  r = await postForm("/api/emergency", form);
  ok("preview analyzed", r.status === 200);
  // valid: حضور + دفع + رصيد + بيع×2 + فتح حصة = 6
  ok("6 valid operations", (r.data.valid as number) === 6, `valid=${r.data.valid}`);
  // التعارضات: ديناميكية — أول تشغيل في يوم نضيف مفيش فيه حصة مقفولة النهاردة
  ok(`${expectedConflicts} conflicts (dynamic)`, (r.data.conflicts as number) === expectedConflicts,
    `conflicts=${r.data.conflicts} expected=${expectedConflicts}`);
  ok("0 duplicates", (r.data.duplicates as number) === 0, `duplicates=${r.data.duplicates}`);
  const conflicts = ((r.data.preview as { conflicts: { reason: string }[] }).conflicts) ?? [];
  ok("conflict reasons shown", conflicts.length > 0 && conflicts.some((c) => c.reason.includes("مفيش طالب")));
  ok("stock conflict detected", conflicts.some((c) => c.reason.includes("المتاح")));

  // ملف غلط
  const badWb = new ExcelJS.Workbook();
  const badBuf = Buffer.from(await badWb.xlsx.writeBuffer());
  form = new FormData();
  form.append("file", new Blob([badBuf], { type: XLSX_TYPE }), "junk.xlsx");
  form.append("action", "preview");
  r = await postForm("/api/emergency", form);
  ok("junk file rejected", r.status === 400, `status=${r.status}`);

  // ============ 5. Commit ============
  console.log("\n— Commit (مزامنة) —");
  form = new FormData();
  form.append("file", new Blob([modBuf], { type: XLSX_TYPE }), "emergency-week-test.xlsx");
  form.append("action", "commit");
  r = await postForm("/api/emergency", form);
  ok("commit success", r.status === 200);
  // الحضور بيفتح الحصة تلقائيًا → زرار «فتح» بقى duplicate (idempotent بالحالة)
  const imported = (r.data.imported as number) ?? -1;
  ok("5 imported + 1 session-duplicate", imported === 5, `imported=${imported} · duplicates=${r.data.duplicates}`);
  ok("duplicates include session-open state", ((r.data.conflictDetails as { reason: string }[]) ?? []).length >= 0 && (r.data.duplicates as number) >= 1);
  const msg = (r.data.message as string) ?? "";
  ok("sync message", msg.includes("تمت مزامنة 5 عملية"), msg);

  // تحقق في الداتابيز: رصيد 10002 = قبل + 77 + 13 (بيع الكتب مش بيدخل رصيد الطالب — زي النظام)
  const stDetail2 = await req(`/api/students/${student.id}`);
  const balanceAfter = (stDetail2.data.balance as number) ?? 0;
  ok("student 10002 balance = before + 90 EGP", balanceAfter - balanceBefore === 9000, `${balanceBefore / 100} → ${balanceAfter / 100} ج`);

  // ============ 6. التحقق من المخزون + الحصة المفتوحة (بالداتابيز مباشرة) ============
  console.log("\n— التحقق من المخزون والحصص —");
  const { PrismaClient } = await import("@prisma/client");
  const pdb = new PrismaClient();

  const physAfter = await pdb.book.findFirst({ where: { name: bookPhysics }, select: { stock: true } });
  ok("physics stock decremented by 2", physAfter?.stock === physBefore.phys - 2, `stock=${physBefore.phys} → ${physAfter?.stock}`);
  const chemAfter = await pdb.book.findFirst({ where: { name: bookChem }, select: { stock: true } });
  ok("chemistry stock decremented by 1", chemAfter?.stock === physBefore.chem - 1, `stock=${physBefore.chem} → ${chemAfter?.stock}`);

  const emgSales = await pdb.bookSale.findMany({
    where: { idemKey: { in: [`EMG-${year}-000005`, `EMG-${year}-000006`] } },
    select: { idemKey: true, total: true, qty: true, buyerName: true, studentId: true, method: true },
  });
  ok("2 book sales imported", emgSales.length === 2, `${emgSales.length} بيعة`);
  const studentSale = emgSales.find((s) => s.studentId);
  const walkinSale = emgSales.find((s) => !s.studentId);
  ok("student book sale total = auto price × qty", studentSale?.total === physBefore.physPrice * 100 * 2, `total=${studentSale?.total} (سعر ${physBefore.physPrice})`);
  ok("walk-in book sale buyer = زبون (نقدي)", walkinSale?.buyerName === "زبون", `buyer=${walkinSale?.buyerName}`);
  ok("book sale method CASH", studentSale?.method === "CASH" && walkinSale?.method === "CASH");
  const bookTxns = await pdb.centerTransaction.findMany({
    where: { type: "BOOK_SALE", refType: "BOOK_SALE", note: { contains: "طوارئ" } },
    select: { amount: true },
  });
  ok("book revenue journaled (2 × BOOK_SALE)", bookTxns.length === 2, `${bookTxns.length} قيد = ${bookTxns.reduce((a, t) => a + t.amount, 0) / 100} ج`);

  // الحصة المفتوحة (من الحضور أو الزرار) — سجّل الـ id للتنضيف
  let openSessId: string | null = null;
  const openSession = await pdb.sessionInstance.findFirst({
    where: { date: today, status: "OPEN" },
    include: { group: { select: { name: true, teacherId: true } }, attendance: true },
  });
  ok("session opened (auto from attendance / زرار)", !!openSession, openSession ? `${openSession.startTime} · حضور: ${openSession.attendance.length}` : "—");
  openSessId = openSession?.id ?? null;

  // ============ 7. قفل الحصة من الملف (بحساباتها) ============
  console.log("\n— زرار قفل الحصة —");
  const dl2 = await fetch(`${BASE}/api/emergency?export=1`, { headers: mcookie ? { Cookie: mcookie } : {} });
  const buf2 = Buffer.from(await dl2.arrayBuffer());
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf2 as unknown as ExcelJS.Buffer);
  const wsW2 = wb2.getWorksheet("حصص الأسبوع")!;
  const openRow2 = wsW2.getRows(2, 300)!.find((row) =>
    String(row.getCell(2).value) === today && String(row.getCell(8).value ?? "") === "مفتوحة 🟢",
  );
  ok("re-export shows open session 🟢", !!openRow2, openRow2 ? String(openRow2.getCell(5).value).slice(0, 40) : "—");
  if (openRow2) {
    openRow2.getCell(9).value = "قفل";
    const closeBuf = Buffer.from(await wb2.xlsx.writeBuffer());
    form = new FormData();
    form.append("file", new Blob([closeBuf], { type: XLSX_TYPE }), "emergency-close-test.xlsx");
    form.append("action", "commit");
    r = await postForm("/api/emergency", form);
    ok("close commit success", r.status === 200 && (r.data.imported as number) === 1, `imported=${r.data.imported}`);

    const closedSession = await pdb.sessionInstance.findFirst({
      where: { date: today, status: "CLOSED" },
      include: { group: { select: { name: true } } },
      orderBy: { closedAt: "desc" },
    });
    ok("session CLOSED", !!closedSession, closedSession ? `${closedSession.startTime} · حضور: ${closedSession.presentCount} · إيراد: ${(closedSession.totalRevenue ?? 0) / 100} ج` : "—");
    if (closedSession && closedSession.group) {
      const settle = await pdb.teacherSettlement.findFirst({
        where: { sessionId: closedSession.id, type: "EARNED" },
      });
      ok("teacher settlement created (EARNED)", !!settle, settle ? `${settle.amount / 100} ج للمدرس` : "—");
      const journal = await pdb.centerTransaction.findMany({
        where: { refId: closedSession.id, refType: "SESSION" },
        select: { type: true, amount: true },
      });
      ok("session journal entries (إيراد + نصيب)", journal.length >= 1, journal.map((j) => `${j.type}: ${j.amount / 100}`).join(" | "));
    }

    // ============ 8. إعادة الاستيراد → كل حاجة duplicate ============
    console.log("\n— إعادة الاستيراد (كشف التكرار) —");
    form = new FormData();
    form.append("file", new Blob([closeBuf], { type: XLSX_TYPE }), "emergency-close-test.xlsx");
    form.append("action", "commit");
    r = await postForm("/api/emergency", form);
    ok("re-import: 0 imported", (r.data.imported as number) === 0, `imported=${r.data.imported}`);
    ok("re-import: duplicates >= 1", ((r.data.duplicates as number) ?? 0) >= 1, `duplicates=${r.data.duplicates}`);
  }

  // رصيد ماتغيرش بعد إعادة الاستيراد
  const stDetail3 = await req(`/api/students/${student.id}`);
  ok("balance unchanged after re-import", (stDetail3.data.balance as number) === balanceAfter);

  // ============ 9. سجل المزامنات ============
  r = await req("/api/emergency");
  const history = (r.data.history as { fileName: string; imported: number }[]) ?? [];
  ok("import history logged", history.length >= 2, `${history.length} عملية`);

  // ============ 10. تنظيف بيانات الاختبار ============
  console.log("\n— تنظيف —");
  const testEmgKeys = [
    `EMG-${year}-000001`, `EMG-${year}-000002`, `EMG-${year}-000003`,
    `EMG-${year}-000005`, `EMG-${year}-000006`,
  ];
  await pdb.attendance.deleteMany({ where: { idemKey: { in: testEmgKeys } } });
  await pdb.studentTransaction.deleteMany({ where: { idemKey: { in: [...testEmgKeys, ...testEmgKeys.map((k) => `chg-${k}`)] } } });
  await pdb.bookSale.deleteMany({ where: { idemKey: { in: testEmgKeys } } });
  await pdb.centerTransaction.deleteMany({ where: { note: { contains: "طوارئ" } } });
  await pdb.teacherSettlement.deleteMany({ where: { note: { contains: "طوارئ" } } });
  // رجّع المخزون زي ما كان
  await pdb.book.updateMany({ where: { name: bookPhysics }, data: { stock: physBefore.phys } });
  await pdb.book.updateMany({ where: { name: bookChem }, data: { stock: physBefore.chem } });
  // امسح الحصة اللي فتحها الاختبار (بس اللي إحنا فتحناها — حسب الـ id المسجل)
  if (openSessId) {
    await pdb.sessionInstance.delete({ where: { id: openSessId } }).catch(() => {});
  }
  const emgImports = await pdb.emergencyImport.deleteMany({ where: { fileName: { contains: "emergency" } } });
  console.log(`  (تنضيف: بيعتين + حضور + دفعات + حصة + ${emgImports.count} سجل استيراد)`);
  const finalStudents = await pdb.student.count();
  await pdb.$disconnect();
  ok("cleanup done", finalStudents >= 20, `${finalStudents} طالب`);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`النتيجة: ${passed} ✓ / ${failed} ✗`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
