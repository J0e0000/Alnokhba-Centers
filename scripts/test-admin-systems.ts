/**
 * Live test of the new backup system + support access + teams.
 * Runs against the dev server on :3000.
 */
const BASE = "http://localhost:3000";
let cookies = "";

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
      ...(opts.headers ?? {}),
    },
    redirect: "manual",
  });
  const setc = res.headers.getSetCookie?.() ?? [];
  if (setc.length) cookies = setc.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const pass = [];
const fail = [];
function check(name, cond, extra = "") {
  (cond ? pass : fail).push(name);
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + String(extra).slice(0, 160) : ""}`);
}

(async () => {
  // ============ 1) admin login ============
  const login = await j("/api/auth", { method: "POST", body: JSON.stringify({ username: "admin", password: "nokhba123" }) });
  check("admin login", login.status === 200 && login.data?.user?.role === "ADMIN", `status=${login.status}`);

  // ============ 2) admin GET now includes users + teams ============
  const overview = await j("/api/admin");
  check("admin overview users list", Array.isArray(overview.data?.users) && overview.data.users.length >= 4, `${overview.data?.users?.length} users`);
  check("admin overview teams list", Array.isArray(overview.data?.teams), `teams=${overview.data?.teams?.length}`);

  // ============ 3) TEAMS: create → add member → verify → rename → disable → remove member ============
  const tName = `فريق الاختبار ${Date.now() % 10000}`;
  const create = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-create", name: tName, description: "اختبار" }) });
  check("team create", create.status === 201 && create.data?.team?.id, create.data?.error);

  const teamId = create.data?.team?.id;
  const mgr = overview.data?.users?.find((u) => u.role === "MANAGER");
  const add = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-add-member", teamId, userId: mgr.id }) });
  check("team add member", add.status === 201, add.data?.error);

  const dup = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-add-member", teamId, userId: mgr.id }) });
  check("team duplicate member blocked", dup.status === 409, `status=${dup.status}`);

  const rename = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-rename", teamId, name: tName + " المعدل" }) });
  check("team rename", rename.status === 200, rename.data?.error);

  const dis = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-set-status", teamId, status: "SUSPENDED" }) });
  check("team disable", dis.status === 200 && dis.data?.isActive === false);

  const overview2 = await j("/api/admin");
  const team2 = overview2.data?.teams?.find((t) => t.id === teamId);
  check("team visible with member", team2 && team2.members.length === 1 && team2.isActive === false, `${team2?.members?.length} members, active=${team2?.isActive}`);

  const rem = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-remove-member", teamId, userId: mgr.id }) });
  check("team remove member", rem.status === 200, rem.data?.error);

  // cleanup: re-enable + leave the test team? delete isn't in API (by design — disable instead)
  await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "team-set-status", teamId, status: "ACTIVE" }) });

  // ============ 4) BACKUPS: status → create-excel → validate ============
  const center1 = overview.data?.centers?.[0];
  const bstatus = await j("/api/admin/backup");
  check("backup status", bstatus.status === 200 && Array.isArray(bstatus.data?.dbBackups) && bstatus.data?.status?.scheduleLabel, bstatus.data?.error);
  console.log(`   schedule: ${bstatus.data?.status?.scheduleLabel} | next: ${bstatus.data?.status?.nextScheduledAt ?? "—"}`);

  const mkExcel = await j("/api/admin/backup", { method: "POST", body: JSON.stringify({ action: "create-excel", centerId: center1.id }) });
  check("create Excel workbook", mkExcel.status === 200 && mkExcel.data?.file, mkExcel.data?.error);
  console.log(`   file: ${mkExcel.data?.file} | sheets: ${mkExcel.data?.sheets} | checksum: ${String(mkExcel.data?.checksum).slice(0, 12)}…`);

  const bstatus2 = await j("/api/admin/backup");
  const excelList = bstatus2.data?.excelBackups ?? [];
  const made = excelList.find((e) => e.file === mkExcel.data?.file);
  check("Excel backup validated in list", Boolean(made?.validated), `validated=${made?.validated}`);

  // download works
  const dl = await fetch(`${BASE}/api/admin/backup?download=${encodeURIComponent(mkExcel.data?.file ?? "")}`, { headers: { Cookie: cookies } });
  const buf = await dl.arrayBuffer();
  const magic = new Uint8Array(buf.slice(0, 2));
  check("Excel download (PK magic bytes)", dl.status === 200 && magic[0] === 0x50 && magic[1] === 0x4b, `status=${dl.status}, size=${buf.byteLength}`);

  // ============ 5) PREVIEW + RESTORE (idempotent) ============
  const dbList = bstatus2.data?.dbBackups ?? [];
  const newestDb = dbList[0]?.file;
  if (newestDb) {
    const prev = await j(`/api/admin/backup?preview=${encodeURIComponent(newestDb)}`);
    check("preview backup db", prev.status === 200 && Array.isArray(prev.data?.tables) && prev.data.tables.length > 0, prev.data?.error);
    const stu = prev.data?.tables?.find((t) => t.table === "Student");
    console.log(`   preview ${newestDb}: center=${prev.data?.centerName}, Students=${stu?.rows}`);

    // restore with all tables → idempotency: التانية لازم 0 inserts
    // (الأولى ممكن تضيف صفوف موجودة في النسخة وناقصة في الإنتاج — دي وظيفتها الصح)
    const restore1 = await j("/api/admin/backup", {
      method: "POST",
      body: JSON.stringify({ action: "restore", file: newestDb, tables: ["Student", "StudentTransaction", "Attendance"] }),
    });
    const firstInserts = (restore1.data?.results ?? []).reduce((a: number, r: { inserted: number }) => a + r.inserted, 0);
    const restore2 = await j("/api/admin/backup", {
      method: "POST",
      body: JSON.stringify({ action: "restore", file: newestDb, tables: ["Student", "StudentTransaction", "Attendance"] }),
    });
    check("targeted restore idempotent (2nd run = 0 inserts)", restore2.status === 200 && (restore2.data?.results ?? []).every((r: { inserted: number }) => r.inserted === 0),
      `first run +${firstInserts} rows (لو النسخة فيها صفوف ناقصة في الإنتاج — دي وظيفة الاستعادة) · second run ${JSON.stringify(restore2.data?.results?.map((r: { table: string; inserted: number }) => `${r.table}:${r.inserted}`))}`);
    // رجّع الحالة زي ما كانت: امسح الصفوف اللي الاستعادة ضافتها (لو ضافت)
    if (firstInserts > 0) {
      const { PrismaClient } = await import("@prisma/client");
      const pdb = new PrismaClient();
      const bakTxns = (await pdb.$queryRawUnsafe(
        `SELECT id FROM StudentTransaction WHERE createdAt >= '2026-09-02T16:30:00Z'`,
      )) as { id: string }[];
      for (const row of bakTxns) await pdb.studentTransaction.deleteMany({ where: { id: row.id } }).catch(() => {});
      await pdb.$disconnect();
    }
  } else {
    check("db backups exist", false, "no .db backups found");
  }

  // ============ 6) SUPPORT ACCESS: start → verify target session + banner ctx → exit ============
  // (target = MANAGER عشان نختبر إثراء التدقيق بعملية مالية كاملة)
  const managerUser = overview.data?.users?.find((u) => u.role === "MANAGER" && u.isActive);
  const sup = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "support-start", targetUserId: managerUser.id, reason: "اختبار الدعم الفني" }) });
  check("support session start", sup.status === 200 && sup.data?.supportId, sup.data?.error);

  // now we are "logged in as" the manager
  const asReception = await j("/api/auth");
  check("support: session is target user", asReception.data?.user?.role === "MANAGER" && asReception.data?.user?.name === managerUser.name, asReception.data?.user?.role);
  check("support: banner context present", Boolean(asReception.data?.user?.support?.byAdminName) && asReception.data?.user?.support?.targetName === managerUser.name,
    `by=${asReception.data?.user?.support?.byAdminName}`);
  console.log(`   banner: دعم فني من ${asReception.data?.user?.support?.byAdminName} — باسم ${asReception.data?.user?.support?.targetName} — ينتهي ${asReception.data?.user?.support?.expiresAt}`);

  // support cannot access admin API (role check on TARGET session)
  const adminTry = await j("/api/admin");
  check("support: admin API blocked", adminTry.status === 403, `status=${adminTry.status}`);

  // staff APIs work as target user
  const dash = await j("/api/dashboard");
  check("support: staff dashboard accessible", dash.status === 200, `status=${dash.status}`);

  // audit enrichment: do a payment as supported user and check audit row
  const students = await j("/api/students");
  const stu0 = students.data?.students?.[0];
  if (stu0) {
    const pay = await j("/api/payments", { method: "POST", body: JSON.stringify({ studentId: stu0.id, amount: 5, type: "ADJUSTMENT", method: "CASH", note: "اختبار تدقيق الدعم" }) });
    if (pay.status === 200) {
      const undo = await j("/api/payments", { method: "POST", body: JSON.stringify({ studentId: stu0.id, amount: -5, type: "ADJUSTMENT", method: "CASH", note: "تراجع" }) });
      const audit = await j("/api/audit");
      const supportRows = (audit.data?.logs ?? []).filter((l) => l.reason?.includes("دعم فني"));
      check("audit rows enriched with support context", supportRows.length >= 2, `${supportRows.length} enriched rows`);
      check("payment during support + reversal OK", undo.status === 200);
    }
  }

  // exit support → back to admin
  const exit = await j("/api/auth", { method: "POST", body: JSON.stringify({ action: "support-exit" }) });
  check("support exit", exit.status === 200, exit.data?.error);
  const after = await j("/api/auth");
  check("back to admin after exit", after.data?.user?.role === "ADMIN" && !after.data?.user?.support, after.data?.user?.role);

  // ============ 7) guards ============
  // أدمن بيستهدف أدمن → مرفوض (نجيب الـ ID الحقيقي بتاع الأدمن)
  const adminId = login.data?.user?.id;
  const selfSup = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "support-start", targetUserId: adminId, reason: "اختبار استهداف أدمن" }) });
  check("support: admin targeting admin blocked", selfSup.status === 400, `status=${selfSup.status} ${selfSup.data?.error ?? ""}`);

  const noReason = await j("/api/admin", { method: "POST", body: JSON.stringify({ action: "support-start", targetUserId: managerUser.id, reason: "ا" }) });
  check("support: short reason blocked", noReason.status === 400, `status=${noReason.status}`);

  // ============ 8) audit contains support + team + backup actions ============
  const auditAll = await j("/api/audit");
  const actions = new Set((auditAll.data?.logs ?? []).map((l) => l.action));
  check("audit: support start logged", actions.has("بدء جلسة دعم فني"));
  check("audit: support end logged", actions.has("إنهاء جلسة دعم فني"));
  check("audit: team create logged", actions.has("إنشاء فريق"));

  console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
  if (fail.length) console.log("FAILED:", fail.join(" | "));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e.message); process.exit(1); });
