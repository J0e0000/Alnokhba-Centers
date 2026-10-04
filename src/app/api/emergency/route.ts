import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { todayStr, dayNameAR, formatTime12 } from "@/lib/normalize";
import { manyBalances, sessionEconomics } from "@/lib/finance";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

// ============================================================
// نظام الطوارئ — الإكسل ده نظام تشغيل مصغّر، مش مجرد تصدير.
// التصدير: أسبوع كامل — طلاب + مجموعات + حصص الأسبوع بزرار فتح/قفل
//          + عمليات (حضور/دفع/رصيد/بيع كتاب بالوقت) + البوكشوب + لوحة أسبوع.
// الاستيراد: مزامنة محكومة (idempotency + كشف تعارض + preview).
// ============================================================

const SHEET_START = "ابدأ من هنا";
const SHEET_STUDENTS = "الطلاب";
const SHEET_GROUPS = "المجموعات";
const SHEET_WEEK = "حصص الأسبوع";
const SHEET_OPS = "عمليات الطوارئ";
const SHEET_BOOKS = "الكتب";
const SHEET_DASH = "لوحة الأسبوع";
const SHEET_TODAY = "حضور النهاردة";
const SHEET_KEYS = "المفاتيح";

const OPS_TYPES = ["حضور", "دفع", "إضافة رصيد", "بيع كتاب"] as const;
const SESSION_ACTIONS = ["فتح", "قفل"] as const;
const OPS_METHODS = ["كاش", "فودافون كاش", "انستاباي"] as const;
const ATT_STATUS = ["حاضر", "متأخر", "بعذر"] as const;

const OPS_ROWS = 250;
const DEFAULT_WINDOW_START = "17:00";
const DEFAULT_WINDOW_END = "22:00";

function groupLabel(subject: string, grade: string, name: string): string {
  return `${subject} — ${grade} (${name})`;
}
function sessionPhaseNow(startTime: string, endTime: string): "past" | "now" | "future" {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  if (endTime < now) return "past";
  if (startTime <= now) return "now";
  return "future";
}
function addDaysStr(date: string, days: number): string {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
/** قيمة رقمية من خلية إكسل (تفهم النتيجة المحسوبة للفورميلا) */
function cellNum(c: ExcelJS.CellValue): number | null {
  if (typeof c === "number") return c;
  if (c && typeof c === "object" && "result" in (c as unknown as Record<string, unknown>)) {
    const r = (c as unknown as { result?: unknown }).result;
    if (typeof r === "number") return r;
    if (r != null && r !== "" && !Number.isNaN(Number(String(r)))) return Number(String(r));
    return null;
  }
  if (c != null && c !== "" && !Number.isNaN(Number(String(c)))) return Number(String(c));
  return null;
}
/** تاريخ من خلية (نص أو Date أو رقم تسلسلي) */
function cellDate(c: ExcelJS.CellValue): string {
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === "number") return new Date(Math.round((c - 25569) * 86400000)).toISOString().slice(0, 10);
  return String(c ?? "").slice(0, 10);
}
/** وقت من خلية (نص HH:MM أو رقم تسلسلي أو Date) → HH:MM نص */
function cellTime(c: ExcelJS.CellValue): string {
  if (c == null || c === "") return "";
  if (typeof c === "number") {
    const total = Math.round((c % 1) * 24 * 60);
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
  }
  if (c instanceof Date) return `${pad2(c.getUTCHours())}:${pad2(c.getUTCMinutes())}`;
  return String(c).trim();
}

// ============================= GET — تصدير / سجل =============================

export const GET = handler(async (req: Request) => {
  const user = await requireManager();
  const url = new URL(req.url);

  if (url.searchParams.get("export") !== "1") {
    // سجل المزامنات
    const history = await db.emergencyImport.findMany({
      where: { centerId: user.centerId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return ok({
      history: history.map((h) => ({
        id: h.id, fileName: h.fileName, totalRows: h.totalRows,
        imported: h.imported, duplicates: h.duplicates, conflicts: h.conflicts,
        importedByName: h.importedByName,
        createdAt: h.createdAt,
      })),
    });
  }

  const today = todayStr();
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysStr(today, i));
  const weekEnd = weekDates[6];

  // ===== نجيب كل حاجة =====
  const [students, groups, slots, books, weekSessions, todaySessions, center] = await Promise.all([
    db.student.findMany({
      where: { centerId: user.centerId, status: { in: ["ACTIVE", "PAUSED"] } },
      include: { grade: { select: { name: true } }, registrations: { where: { status: "ACTIVE" }, include: { group: { include: { subject: { select: { name: true } }, grade: { select: { name: true } } } } } } },
      orderBy: { name: "asc" },
    }),
    db.group.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: { subject: true, grade: true, teacher: true, _count: { select: { students: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.scheduleSlot.findMany({ where: { centerId: user.centerId, isActive: true }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] }),
    db.book.findMany({
      where: { centerId: user.centerId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, price: true, costPrice: true, stock: true },
    }),
    db.sessionInstance.findMany({
      where: { centerId: user.centerId, date: { in: weekDates }, status: { not: "CANCELLED" } },
      include: {
        group: { include: { subject: true, grade: true, teacher: true } },
        attendance: { where: { status: { in: ["PRESENT", "LATE"] } }, select: { id: true } },
      },
    }),
    db.sessionInstance.findMany({
      where: { centerId: user.centerId, date: today, status: { not: "CANCELLED" } },
      include: {
        group: { include: { subject: true, grade: true, teacher: true } },
        attendance: { include: { student: { select: { code: true, name: true } } } },
      },
      orderBy: { startTime: "asc" },
    }),
    db.center.findUnique({ where: { id: user.centerId } }),
  ]);
  if (!center) throw new ApiError("السنتر مش موجود.", 404);

  const balances = await manyBalances(students.map((s) => s.id));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // ===== صفوف الأسبوع: سلوة الجدول × 7 أيام + أي حصص فعلية موجودة =====
  type WeekRow = {
    ses: string; date: string; day: string; start: string; end: string;
    label: string; room: string | null; price: number;
    scheduleId: string | null; groupId: string;
    sessionId: string | null; status: string; attended: number;
  };
  const weekRows: WeekRow[] = [];
  let sesN = 0;
  const matchedInstances = new Set<string>();
  for (const date of weekDates) {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const daySlots = slots.filter((s) => s.dayOfWeek === dow);
    for (const slot of daySlots) {
      const g = groupById.get(slot.groupId ?? "");
      if (!g) continue;
      const inst = weekSessions.find(
        (s) => s.groupId === g.id && s.date === date && s.startTime === slot.startTime,
      ) ?? weekSessions.find((s) => s.groupId === g.id && s.date === date && !matchedInstances.has(s.id));
      if (inst) matchedInstances.add(inst.id);
      sesN++;
      weekRows.push({
        ses: `SES-${String(sesN).padStart(3, "0")}`,
        date, day: dayNameAR(dow), start: slot.startTime, end: slot.endTime,
        label: groupLabel(g.subject.name, g.grade.name, g.name),
        room: slot.room ?? g.room, price: g.sessionPrice,
        scheduleId: slot.id, groupId: g.id,
        sessionId: inst?.id ?? null,
        status: inst ? (inst.status === "OPEN" ? "مفتوحة 🟢" : inst.status === "CLOSED" || inst.status === "COMPLETED" ? "مقفولة ✓" : String(inst.status)) : "مجدولة",
        attended: inst?.attendance.length ?? 0,
      });
    }
    // حصص فعلية من غير سلوة جدول (استثنائية)
    for (const inst of weekSessions.filter((s) => s.date === date && !matchedInstances.has(s.id))) {
      const g = inst.group;
      matchedInstances.add(inst.id);
      sesN++;
      weekRows.push({
        ses: `SES-${String(sesN).padStart(3, "0")}`,
        date, day: dayNameAR(dow), start: inst.startTime, end: inst.endTime,
        label: groupLabel(g?.subject.name ?? "", g?.grade.name ?? "", g?.name ?? ""),
        room: inst.room, price: inst.price,
        scheduleId: inst.scheduleId, groupId: g?.id ?? "",
        sessionId: inst.id,
        status: inst.status === "OPEN" ? "مفتوحة 🟢" : inst.status === "CLOSED" || inst.status === "COMPLETED" ? "مقفولة ✓" : String(inst.status),
        attended: inst.attendance.length,
      });
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "NOKHBA CENTERS";
  wb.created = new Date();

  // ==================== 1) ابدأ من هنا ====================
  const wsStart = wb.addWorksheet(SHEET_START, { views: [{ rightToLeft: true }] });
  wsStart.columns = [{ width: 4 }, { width: 110 }];
  const startRows: [string, string][] = [
    ["", `${center.name} — نظام الطوارئ (NOKHBA Emergency Excel — أسبوع كامل)`],
    ["", `اتعمل الملف ده: ${today} — يغطي أسبوع كامل (${today} → ${weekEnd}). لو الموقع وقع، شغّل من هنا وكمّل عادي.`],
    ["", ""],
    ["", "إزاي تستخدمه (4 خطوات):"],
    ["", "1) افتح شيت «حصص الأسبوع» — كل حصص الأسبوع هناك. عايز تبدأ حصة؟ اختار «فتح» في عمود «زرار الحصة». خلصت؟ اختار «قفل» — زي النظام بالظبط"],
    ["", "2) الطالب حضر/دفع؟ ضيف صف في «عمليات الطوارئ» — كل حاجة dropdown جاهزة. حط الوقت (17:30 مثلاً) لو عايز تتبع فترة الكاش"],
    ["", "3) الحصة ألحقت طالب اشترى كتاب؟ نفس الشيت — نوع العملية «بيع كتاب» + اختار الكتاب والكمية (المبلغ بيتحسب لوحده)"],
    ["", "4) لما الموقع يرجع: المدير يرفع الملف من صفحة «الطوارئ» والنظام يزامن كل حاجة"],
    ["", ""],
    ["", "قواعد مهمة:"],
    ["", "• كل عملية لها «كود العملية» فريد (EMG-...) وكل حصة لها كود (SES-...) — متعبّيين جاهزين، متغيروش"],
    ["", "• «حضور»: اختار المجموعة — النظام هيخصم سعر الحصة من رصيد الطالب وقت المزامنة (ويفتح الحصة لو مفتحتش)"],
    ["", "• «دفع»: المبلغ الفعلي + طريقة الدفع + الوقت لو حابب تدخل ضمن فترة الكاش"],
    ["", "• «بيع كتاب»: الكتاب من القايمة + الكمية — بيتخصم من المخزون وقت المزامنة"],
    ["", "• «فتح / قفل» الحصص من شيت «حصص الأسبوع» — القفل بيحسب الحضور والإيراد ونصيب المدرس زي النظام"],
    ["", "• متعملش صفين لنفس العملية — التكرار بيتكشف وقت المزامنة وبيتخطى"],
    ["", ""],
    ["", "لوحة الأسبوع بتتحدّث لوحدها: فترة الكاش (غيّر «من/للوقت») + إيراد البوكشوب + الحضور والحصص."],
    ["", "⚠️ الملف ده فيه بيانات طلاب وفلوس — احتفظ بيه في أمان."],
  ];
  startRows.forEach((r, i) => {
    const row = wsStart.getRow(i + 1);
    row.getCell(2).value = r[1];
    if (i === 0) { row.getCell(2).font = { bold: true, size: 16 }; }
    if (r[1]?.startsWith("إزاي") || r[1]?.startsWith("قواعد") || r[1]?.startsWith("لوحة")) { row.getCell(2).font = { bold: true, size: 13 }; }
    if (r[1]?.startsWith("⚠️")) { row.getCell(2).font = { bold: true, color: { argb: "FFB91C1C" } }; }
    row.height = i === 0 ? 26 : 20;
  });

  // ==================== 2) الطلاب ====================
  const wsSt = wb.addWorksheet(SHEET_STUDENTS, { views: [{ rightToLeft: true }] });
  wsSt.columns = [
    { header: "الكود", key: "code", width: 10 },
    { header: "الاسم", key: "name", width: 28 },
    { header: "الموبايل", key: "phone", width: 15 },
    { header: "المرحلة", key: "grade", width: 16 },
    { header: "المجموعات", key: "groups", width: 40 },
    { header: "الرصيد (جنيه)", key: "balance", width: 14 },
    { header: "الحالة", key: "status", width: 12 },
  ];
  wsSt.getRow(1).font = { bold: true, size: 11 };
  wsSt.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5F0" } };
  for (const s of students) {
    const bal = (balances.get(s.id) ?? 0) / 100;
    wsSt.addRow({
      code: Number(s.code), name: s.name, phone: s.phone ?? s.parentPhone ?? "",
      grade: s.grade?.name ?? "", groups: s.registrations.map((r) => groupLabel(r.group.subject.name, r.group.grade.name, r.group.name)).join(" + "),
      balance: bal, status: s.status === "ACTIVE" ? "شغال" : "متوقف",
    });
  }
  wsSt.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  for (let i = 2; i <= students.length + 1; i++) {
    const b = wsSt.getRow(i).getCell(6);
    b.numFmt = "#,##0.00";
    const val = b.value as number;
    if (typeof val === "number") {
      if (val < 0) b.font = { bold: true, color: { argb: "FFC2410C" } };
      else if (val > 0) b.font = { bold: true, color: { argb: "FF15803D" } };
    }
  }

  // ==================== 3) المجموعات ====================
  const wsG = wb.addWorksheet(SHEET_GROUPS, { views: [{ rightToLeft: true }] });
  wsG.columns = [
    { header: "المجموعة", key: "label", width: 42 },
    { header: "المدرس", key: "teacher", width: 20 },
    { header: "سعر الحصة (جنيه)", key: "price", width: 16 },
    { header: "المواعيد", key: "times", width: 34 },
    { header: "القاعة", key: "room", width: 12 },
    { header: "عدد الطلاب", key: "count", width: 12 },
  ];
  wsG.getRow(1).font = { bold: true, size: 11 };
  wsG.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5F0" } };
  const groupLabels: string[] = [];
  for (const g of groups) {
    const label = groupLabel(g.subject.name, g.grade.name, g.name);
    groupLabels.push(label);
    const times = slots
      .filter((sl) => sl.groupId === g.id)
      .map((sl) => `${dayNameAR(sl.dayOfWeek)} ${sl.startTime}-${sl.endTime}`)
      .join(" / ");
    wsG.addRow({ label, teacher: g.teacher?.name ?? "—", price: g.sessionPrice / 100, times, room: g.room ?? "—", count: g._count.students });
  }
  wsG.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

  // ==================== 4) حصص الأسبوع — التحكم بالحصص (زرار فتح/قفل) ====================
  const wsW = wb.addWorksheet(SHEET_WEEK, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  wsW.columns = [
    { header: "كود الحصة", key: "ses", width: 12 },
    { header: "التاريخ", key: "date", width: 13 },
    { header: "اليوم", key: "day", width: 11 },
    { header: "الوقت", key: "time", width: 15 },
    { header: "المجموعة", key: "group", width: 40 },
    { header: "القاعة", key: "room", width: 11 },
    { header: "السعر (جنيه)", key: "price", width: 13 },
    { header: "الحالة", key: "status", width: 13 },
    { header: "زرار الحصة", key: "action", width: 14 },
    { header: "حضروا", key: "attended", width: 8 },
  ];
  wsW.getRow(1).font = { bold: true, size: 11 };
  wsW.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
  wsW.getRow(1).height = 22;
  for (const r of weekRows) {
    const row = wsW.addRow({
      ses: r.ses, date: r.date, day: r.day, time: `${r.start} - ${r.end}`,
      group: r.label, room: r.room ?? "—", price: r.price / 100,
      status: r.status, action: null, attended: r.attended || null,
    });
    row.getCell(2).numFmt = "yyyy-mm-dd";
    row.getCell(7).numFmt = "#,##0";
    if (r.status === "مفتوحة 🟢") {
      row.getCell(8).font = { bold: true, color: { argb: "FF15803D" } };
    } else if (r.status === "مقفولة ✓") {
      row.getCell(8).font = { bold: true, color: { argb: "FF6B7280" } };
    }
    // زرار الحصة — القايمة
    row.getCell(9).dataValidation = {
      type: "list", allowBlank: true,
      formulae: [`"${SESSION_ACTIONS.join(",")}"`],
      showErrorMessage: true, errorTitle: "قيمة مش صح", error: "اختار: فتح أو قفل (أو سيبه فاضي)",
    };
  }
  wsW.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
  const weekLast = Math.max(weekRows.length + 1, 2);

  // ==================== 5) عمليات الطوارئ (نموذج الإدخال) ====================
  const wsOps = wb.addWorksheet(SHEET_OPS, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  wsOps.columns = [
    { header: "كود العملية", key: "emg", width: 18 },
    { header: "التاريخ", key: "date", width: 13 },
    { header: "الوقت (24 ساعة)", key: "time", width: 13 },
    { header: "كود الطالب", key: "code", width: 12 },
    { header: "اسم الطالب", key: "name", width: 26 },
    { header: "نوع العملية", key: "type", width: 13 },
    { header: "المجموعة (للحضور)", key: "group", width: 40 },
    { header: "الكتاب (لبيع الكتاب)", key: "book", width: 30 },
    { header: "الكمية", key: "qty", width: 8 },
    { header: "المبلغ (جنيه)", key: "amount", width: 14 },
    { header: "طريقة الدفع", key: "method", width: 14 },
    { header: "ملاحظات", key: "note", width: 24 },
    { header: "وقت معالج", key: "tnorm", width: 10 },
  ];
  wsOps.getRow(1).font = { bold: true, size: 11 };
  wsOps.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  wsOps.getRow(1).height = 22;
  wsOps.getColumn(13).hidden = true; // عمود مساعد للوحة الكاش (متبيّنش)

  const year = today.slice(0, 4);
  for (let i = 0; i < OPS_ROWS; i++) {
    const r = i + 2;
    const row = wsOps.getRow(r);
    row.getCell(1).value = `EMG-${year}-${String(i + 1).padStart(6, "0")}`;
    row.getCell(2).value = today;
    row.getCell(2).numFmt = "yyyy-mm-dd";
    row.getCell(3).numFmt = "@"; // الوقت نص
    // اسم الطالب: VLOOKUP تلقائي من شيت الطلاب
    row.getCell(5).value = { formula: `IFERROR(VLOOKUP(D${r},'${SHEET_STUDENTS}'!$A$2:$B$${students.length + 1},2,0),"")` };
    row.getCell(10).numFmt = "#,##0.00";
    // المبلغ: بيع كتاب → سعر الكتاب × الكمية تلقائي (أو اكتبه بنفسك لأي نوع تاني)
    row.getCell(10).value = {
      formula: `IF($F${r}="بيع كتاب",IFERROR(VLOOKUP($H${r},'${SHEET_BOOKS}'!$A$2:$B$${Math.max(books.length + 1, 2)},2,0)*$I${r},""),"")`,
    };
    // وقت معالج (نص HH:MM دايمًا) — بتستخدمه لوحة فترة الكاش
    row.getCell(13).value = { formula: `IF($C${r}="","",IF(ISNUMBER($C${r}),TEXT($C${r},"hh:mm"),$C${r}))` };
  }
  const lastRow = OPS_ROWS + 1;
  for (let i = 2; i <= lastRow; i++) {
    const row = wsOps.getRow(i);
    row.getCell(4).dataValidation = {
      type: "list", allowBlank: true, formulae: [`'${SHEET_STUDENTS}'!$A$2:$A$${students.length + 1}`],
      showErrorMessage: false, // كود الطالب اختياري (بيع كتاب لزبون نقدي)
    };
    row.getCell(6).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${OPS_TYPES.join(",")}"`],
      showErrorMessage: true, errorTitle: "قيمة مش صح", error: `اختار من: ${OPS_TYPES.join(" / ")}`,
    };
    row.getCell(7).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${groupLabels.join(",")}"`],
      showErrorMessage: false,
    };
    if (books.length > 0) {
      row.getCell(8).dataValidation = {
        type: "list", allowBlank: true, formulae: [`'${SHEET_BOOKS}'!$A$2:$A$${books.length + 1}`],
        showErrorMessage: true, errorTitle: "كتاب مش موجود", error: "اختار كتاب من القايمة",
      };
    }
    row.getCell(11).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${OPS_METHODS.join(",")}"`],
      showErrorMessage: true, errorTitle: "قيمة مش صح", error: `اختار من: ${OPS_METHODS.join(" / ")}`,
    };
  }
  wsOps.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } };

  // ==================== 6) الكتب (البوكشوب) ====================
  const wsB = wb.addWorksheet(SHEET_BOOKS, { views: [{ rightToLeft: true }] });
  wsB.columns = [
    { header: "اسم الكتاب", key: "name", width: 36 },
    { header: "سعر البيع (جنيه)", key: "price", width: 16 },
    { header: "المتاح حاليًا", key: "stock", width: 13 },
    { header: "تنبيه مخزون", key: "low", width: 14 },
  ];
  wsB.getRow(1).font = { bold: true, size: 11 };
  wsB.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5F0" } };
  const bookNames: string[] = [];
  for (const b of books) {
    bookNames.push(b.name);
    const row = wsB.addRow({ name: b.name, price: b.price / 100, stock: b.stock });
    row.getCell(2).numFmt = "#,##0.00";
    if (b.stock <= 3) {
      row.getCell(3).font = { bold: true, color: { argb: "FFC2410C" } };
      row.getCell(4).value = "قرب يخلص ⚠";
      row.getCell(4).font = { bold: true, color: { argb: "FFC2410C" } };
    }
  }
  wsB.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

  // ==================== 7) لوحة الأسبوع (فورميلات) ====================
  const wsD = wb.addWorksheet(SHEET_DASH, { views: [{ rightToLeft: true }] });
  const O = `'${SHEET_OPS}'`;
  const W = `'${SHEET_WEEK}'`;
  wsD.getColumn(1).width = 34;
  wsD.getColumn(2).width = 22;
  wsD.getColumn(5).hidden = true; // خلايا مساعدة لفترة الكاش

  const section = (i: number, text: string, color = "FF143159") => {
    const row = wsD.getRow(i);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold: true, size: 13, color: { argb: color } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
  };
  const stat = (i: number, label: string, formula: string) => {
    const row = wsD.getRow(i);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = /^\d+$/.test(formula) ? Number(formula) : { formula };
    row.getCell(2).font = { bold: true, size: 13 };
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(2).numFmt = "#,##0";
  };

  const title = wsD.getRow(1);
  title.getCell(1).value = "لوحة الأسبوع — بتتحدّث لوحدها من «عمليات الطوارئ» و«حصص الأسبوع»";
  title.getCell(1).font = { bold: true, size: 14 };

  // ---- فترة الكاش ----
  section(3, "💰 كاش الفترة (غيّر الوقتين وهتتحدّث لوحدها)");
  const winFrom = wsD.getRow(4);
  winFrom.getCell(1).value = "من الساعة (مثال 17:00)";
  winFrom.getCell(1).font = { bold: true };
  winFrom.getCell(2).value = DEFAULT_WINDOW_START;
  winFrom.getCell(2).numFmt = "@";
  winFrom.getCell(2).font = { bold: true, size: 13, color: { argb: "FFC2410C" } };
  const winTo = wsD.getRow(5);
  winTo.getCell(1).value = "للوقت (مثال 22:00)";
  winTo.getCell(1).font = { bold: true };
  winTo.getCell(2).value = DEFAULT_WINDOW_END;
  winTo.getCell(2).numFmt = "@";
  winTo.getCell(2).font = { bold: true, size: 13, color: { argb: "FFC2410C" } };
  // خلايا مساعدة: تأكد إن الفترة نص HH:MM حتى لو اتكتبت وقت
  wsD.getCell("E4").value = { formula: `IF(ISNUMBER($B$4),TEXT($B$4,"hh:mm"),$B$4)` };
  wsD.getCell("E5").value = { formula: `IF(ISNUMBER($B$5),TEXT($B$5,"hh:mm"),$B$5)` };
  stat(6, "كاش في الفترة (جنيه)", `SUMIFS(${O}!$J$2:$J$${lastRow},${O}!$F$2:$F$${lastRow},"دفع",${O}!$K$2:$K$${lastRow},"كاش",${O}!$M$2:$M$${lastRow},">="&$E$4,${O}!$M$2:$M$${lastRow},"<="&$E$5)`);
  stat(7, "عدد دفعات كاش في الفترة", `COUNTIFS(${O}!$F$2:$F$${lastRow},"دفع",${O}!$K$2:$K$${lastRow},"كاش",${O}!$M$2:$M$${lastRow},">="&$E$4,${O}!$M$2:$M$${lastRow},"<="&$E$5)`);

  // ---- المحصلة ----
  section(9, "📊 المحصلة (كل الطرق)");
  stat(10, "عدد عمليات الحضور", `COUNTIF(${O}!$F$2:$F$${lastRow},"حضور")`);
  stat(11, "عدد الدفعات", `COUNTIF(${O}!$F$2:$F$${lastRow},"دفع")`);
  stat(12, "إجمالي المحصل (جنيه)", `SUMIF(${O}!$F$2:$F$${lastRow},"دفع",${O}!$J$2:$J$${lastRow})`);
  stat(13, "كاش إجمالي (جنيه)", `SUMIFS(${O}!$J$2:$J$${lastRow},${O}!$F$2:$F$${lastRow},"دفع",${O}!$K$2:$K$${lastRow},"كاش")`);
  stat(14, "فودافون كاش (جنيه)", `SUMIFS(${O}!$J$2:$J$${lastRow},${O}!$F$2:$F$${lastRow},"دفع",${O}!$K$2:$K$${lastRow},"فودافون كاش")`);
  stat(15, "انستاباي (جنيه)", `SUMIFS(${O}!$J$2:$J$${lastRow},${O}!$F$2:$F$${lastRow},"دفع",${O}!$K$2:$K$${lastRow},"انستاباي")`);
  stat(16, "أرصدة اتضافت (جنيه)", `SUMIF(${O}!$F$2:$F$${lastRow},"إضافة رصيد",${O}!$J$2:$J$${lastRow})`);

  // ---- البوكشوب ----
  section(18, "📚 البوكشوب");
  stat(19, "عدد مبيعات الكتب", `COUNTIF(${O}!$F$2:$F$${lastRow},"بيع كتاب")`);
  stat(20, "إيراد الكتب (جنيه)", `SUMIF(${O}!$F$2:$F$${lastRow},"بيع كتاب",${O}!$J$2:$J$${lastRow})`);

  // ---- الحصص ----
  section(22, "🎓 الحصص (زرار فتح/قفل)");
  stat(23, "حصص اتفتحت من الملف", `COUNTIF(${W}!$I$2:$I$${weekLast},"فتح")`);
  stat(24, "حصص اتقفلت من الملف", `COUNTIF(${W}!$I$2:$I$${weekLast},"قفل")`);

  // ---- السنتر ----
  section(26, "📇 السنتر");
  stat(27, "عدد الطلاب", String(students.length));
  stat(28, "عدد المجموعات النشطة", String(groups.length));

  // ==================== 8) حضور النهاردة (مرجع) ====================
  const wsT = wb.addWorksheet(SHEET_TODAY, { views: [{ rightToLeft: true }] });
  let rowT = 1;
  const noteRow = wsT.getRow(rowT++);
  noteRow.getCell(1).value = "مرجع سريع لحصص النهاردة — تسجيل الحضور الفعلي من شيت «عمليات الطوارئ». فتح/قفل الحصص من شيت «حصص الأسبوع».";
  noteRow.getCell(1).font = { bold: true, color: { argb: "FF6B7280" } };
  if (todaySessions.length === 0) {
    const r = wsT.getRow(rowT++);
    r.getCell(1).value = "مفيش حصص فعلية اتفتحت النهاردة — شوف الجدول في شيت «المجموعات» و«حصص الأسبوع».";
    r.getCell(1).font = { bold: true };
  }
  for (const sess of todaySessions) {
    const g = sess.group;
    const phase = sessionPhaseNow(sess.startTime, sess.endTime);
    const hdr = wsT.getRow(rowT++);
    hdr.getCell(1).value = `${g?.subject.name ?? sess.name ?? "حصة"} — ${g?.grade.name ?? ""} (مجموعة ${g?.name ?? "—"}) · ${formatTime12(sess.startTime)} — ${formatTime12(sess.endTime)} · ${g?.teacher?.name ?? "—"} · ${phase === "now" ? "🟢 شغالة" : phase === "future" ? "جاية" : "خلصت"}`;
    hdr.getCell(1).font = { bold: true, size: 12 };
    hdr.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5F0" } };
    const attendedIds = new Set(sess.attendance.map((a) => a.student?.code ?? a.studentCode ?? ""));
    if (!g) continue; // حصة حضور مفتوح — مش جزء من كشف المجموعات
    const regs = await db.studentGroup.findMany({
      where: { groupId: g.id, status: "ACTIVE", student: { status: { in: ["ACTIVE", "PAUSED"] } } },
      include: { student: { select: { code: true, name: true } } },
      orderBy: { student: { name: "asc" } },
    });
    const cols = ["الكود", "الاسم", "الحالة"];
    const headRow = wsT.getRow(rowT++);
    cols.forEach((c, i) => { headRow.getCell(i + 1).value = c; headRow.getCell(i + 1).font = { bold: true }; });
    for (const r of regs) {
      const row = wsT.getRow(rowT++);
      row.getCell(1).value = Number(r.student.code);
      row.getCell(2).value = r.student.name;
      row.getCell(3).value = attendedIds.has(r.student.code) ? "حضر ✅" : "";
    }
    rowT++; // سطر فاضي بين الحصص
  }

  // ==================== 9) المفاتيح (hidden — للمزامنة) ====================
  const wsK = wb.addWorksheet(SHEET_KEYS, { state: "hidden" });
  wsK.addRow(["centerId", user.centerId]);
  wsK.addRow(["exportDate", today]);
  wsK.addRow(["weekStart", today]);
  wsK.addRow(["weekEnd", weekEnd]);
  groupLabels.forEach((label, i) => {
    const g = groups[i];
    wsK.addRow(["group", label, g.id, g.sessionPrice, g.subject.name, g.grade.name, g.name, g.teacherId]);
  });
  books.forEach((b) => {
    wsK.addRow(["book", b.name, b.id, b.price, b.costPrice]);
  });
  for (const r of weekRows) {
    wsK.addRow(["session", r.ses, r.scheduleId ?? "", r.date, r.groupId, r.label, r.sessionId ?? "", r.start, r.end]);
  }
  wsK.addRow(["studentCount", String(students.length)]);

  // ===== رجّع الملف =====
  const buffer = await wb.xlsx.writeBuffer();
  const fileName = encodeURIComponent(`NOKHBA-EMERGENCY-${center.name}-${today}.xlsx`).replace(/%20/g, " ");

  await logAudit({
    user,
    action: AUDIT.EMERGENCY_EXPORTED,
    entity: "CENTER",
    entityId: user.centerId,
    after: { date: today, week: `${today} → ${weekEnd}`, students: students.length, groups: groups.length, sessions: weekRows.length, books: books.length },
  });

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="NOKHBA-Emergency.xlsx"; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store",
    },
  });
});
