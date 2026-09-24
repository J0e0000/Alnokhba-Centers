import "server-only";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   نسخ احتياطية آمنة (Backups)
   - لقطة فيزيائية متسقة لقاعدة SQLite عبر VACUUM INTO (بدون قفل الكتابة)
   - مصنف Excel كامل لكل سنتر (Alnokhba_Backup_YYYY-MM-DD_HH-mm.xlsx)
   - تحقق آلي بعد الإنشاء: الملف موجود + بيتفتح + الشيتات + أعداد الصفوف + checksum
   - معاينة واستعادة موجّهة (الصفوف الناقصة بس — من غير مسح أي حاجة)
   - جدول أسبوعي: الجمعة 22:00 بتوقيت القاهرة (server-side scheduler)
   - احتفاظ بآخر 7 نسخ من كل نوع على قرص السيرفر المحلي
   ملاحظة أمانة: التخزين محلي على نفس الجهاز — لو الجهاز نفسه ضاع،
   النسخ ضاعت معاه. التنزيل اليدوي (تحميل نسخة احتياطية) هو الضمان الحقيقي.
============================================================ */

import { mkdir, readdir, stat, unlink, writeFile, readFile, access } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import type { Column as ExcelColumn } from "exceljs";

const BACKUP_DIR = path.join(process.cwd(), "backups");
const STATUS_FILE = path.join(BACKUP_DIR, "status.json");
const EXCEL_META_FILE = path.join(BACKUP_DIR, "excel-meta.json");
const RETENTION = 7;

export type BackupStatus = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  backups: { file: string; size: number; createdAt: string }[];
  // الجدولة الأسبوعية (الجمعة 22:00 بتوقيت القاهرة)
  lastWeeklyAt?: string | null;
  lastWeeklyTrigger?: string | null;
  nextScheduledAt?: string | null;
};

async function readStatus(): Promise<BackupStatus> {
  try {
    const raw = await readFile(STATUS_FILE, "utf8");
    return JSON.parse(raw) as BackupStatus;
  } catch {
    return { lastSuccessAt: null, lastFailureAt: null, lastError: null, backups: [] };
  }
}

async function writeStatus(s: BackupStatus): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(STATUS_FILE, JSON.stringify(s, null, 2), "utf8");
}

async function listBackupFiles(): Promise<{ file: string; size: number; createdAt: string }[]> {
  try {
    const names = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith("nokhba-backup-") && f.endsWith(".db"));
    const out: { file: string; size: number; createdAt: string }[] = [];
    for (const name of names) {
      const st = await stat(path.join(BACKUP_DIR, name));
      out.push({ file: name, size: st.size, createdAt: st.mtime.toISOString() });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** Create a consistent physical snapshot of the SQLite database. Returns file name. */
export async function createBackup(reason: "manual" | "scheduled"): Promise<{ file: string; size: number }> {
  await mkdir(BACKUP_DIR, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const file = `nokhba-backup-${stamp}.db`;
  const target = path.join(BACKUP_DIR, file);

  try {
    // VACUUM INTO produces a transactionally-consistent snapshot without blocking writers.
    await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const s = await readStatus();
    await writeStatus({ ...s, lastFailureAt: new Date().toISOString(), lastError: `${reason}: ${msg}` });
    throw e;
  }

  // retention: keep newest RETENTION files
  const files = await listBackupFiles();
  for (const old of files.slice(RETENTION)) {
    try { await unlink(path.join(BACKUP_DIR, old.file)); } catch { /* best effort */ }
  }

  const st = await stat(target);
  const status = await readStatus();
  await writeStatus({
    lastSuccessAt: now.toISOString(),
    lastFailureAt: status.lastFailureAt,
    lastError: status.lastError,
    backups: await listBackupFiles(),
  });

  return { file, size: st.size };
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const status = await readStatus();
  return { ...status, backups: await listBackupFiles() };
}

/* ============================================================
   مصنف Excel الاحتياطي — Alnokhba_Backup_YYYY-MM-DD_HH-mm.xlsx
   مفيش أي بيانات سرية: مفيش باسوردات ولا هاشات ولا مفاتيح.
   الفلوس بالجنيه (عمودين: القيمة + الوحدة موضّحة في كل شيت).
============================================================ */

export type ExcelBackupMeta = {
  file: string;
  centerId: string;
  centerName: string;
  size: number;
  createdAt: string;
  checksum: string;
  validated: boolean;
  validationError?: string;
  sheets: { name: string; rows: number }[];
};

const SHEET_HEADER_FILL = "FFE8F5F1"; // أخضر نخبة فاتح

/** إنشاء مصنف Excel كامل لسنتر واحد + تحقق آلي + تسجيله في status.json */
export async function createExcelBackup(centerId: string, reason: "manual" | "scheduled"): Promise<ExcelBackupMeta> {
  const center = await db.center.findUnique({ where: { id: centerId } });
  if (!center) throw new Error("السنتر ده مش موجود.");

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  const file = `Alnokhba_Backup_${stamp}_${center.slug}.xlsx`;
  const target = path.join(BACKUP_DIR, file);

  // بيانات كل الجداول (نفس منطق exportCenterJson لكن بأعمدة مقروءة)
  const [
    users, students, registrations, grades, subjects, teachers, groups, rooms,
    schedules, sessions, attendance, transactions, expenses, settlements,
    centerTxns, cashDays, books, bookSales, receipts, templates, announcements, auditLogs,
  ] = await Promise.all([
    db.user.findMany({ where: { centerId }, select: { name: true, username: true, role: true, isActive: true, createdAt: true } }),
    db.student.findMany({ where: { centerId }, orderBy: { code: "asc" } }),
    db.studentGroup.findMany({ where: { student: { centerId } }, include: { student: { select: { name: true, code: true } }, group: { include: { subject: { select: { name: true } }, grade: { select: { name: true } } } } } }),
    db.grade.findMany({ where: { centerId }, orderBy: { order: "asc" } }),
    db.subject.findMany({ where: { centerId } }),
    db.teacher.findMany({ where: { centerId } }),
    db.group.findMany({ where: { centerId }, include: { subject: true, grade: true, teacher: true } }),
    db.room.findMany({ where: { centerId } }),
    db.scheduleSlot.findMany({ where: { centerId }, include: { group: { include: { subject: true, grade: true, teacher: true } } }, orderBy: { dayOfWeek: "asc" } }),
    db.sessionInstance.findMany({ where: { centerId }, orderBy: { date: "desc" }, include: { group: { include: { subject: true, grade: true, teacher: true } } } }),
    db.attendance.findMany({ where: { centerId }, include: { student: { select: { name: true, code: true } }, session: { include: { group: { include: { subject: { select: { name: true } } } } } } } }),
    db.studentTransaction.findMany({ where: { centerId }, orderBy: { createdAt: "asc" }, include: { student: { select: { name: true, code: true } } } }),
    db.expense.findMany({ where: { centerId }, orderBy: { date: "desc" } }),
    db.teacherSettlement.findMany({ where: { centerId }, include: { teacher: { select: { name: true } } } }),
    db.centerTransaction.findMany({ where: { centerId }, orderBy: { date: "desc" } }),
    db.cashDay.findMany({ where: { centerId } }),
    db.book.findMany({ where: { centerId } }),
    db.bookSale.findMany({ where: { centerId }, include: { book: { select: { name: true } } } }),
    db.receipt.findMany({ where: { centerId }, orderBy: { seq: "desc" }, include: { student: { select: { name: true, code: true } } } }),
    db.whatsAppTemplate.findMany({ where: { centerId } }),
    db.announcement.findMany({ where: { centerId }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { centerId }, orderBy: { createdAt: "desc" } }),
  ]);

  // أرصدة الطلاب من الليدجر (زي ما النظام بيحسبها بالظبط)
  const balanceByStudent = new Map<string, number>();
  for (const t of transactions) {
    balanceByStudent.set(t.studentId, (balanceByStudent.get(t.studentId) ?? 0) + t.amount);
  }

  const egp = (p: number | null | undefined) => Math.round(p ?? 0) / 100;
  const dt = (d: Date | null | undefined) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "");
  const dayAR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const statusAR = (s: string) => s === "OPEN" ? "مفتوحة" : s === "CLOSED" ? "مقفولة" : s === "CANCELLED" ? "ملغاة" : s;
  const txnTypeAR = (t: string) => t === "PAYMENT" ? "دفعة" : t === "REFUND" ? "استرداد" : t === "CHARGE" ? "خصم حصة" : "تسوية";
  const methodAR = (m: string | null) => m === "CASH" ? "كاش" : m === "VODAFONE" ? "فودافون كاش" : m === "INSTAPAY" ? "إنستاباي" : m ?? "";

  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "AlNokhba Centers";
  wb.created = now;

  const sheetsMeta: { name: string; rows: number }[] = [];
  const addSheet = (name: string, columns: Partial<ExcelColumn>[], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = columns as ExcelColumn[];
    const header = ws.getRow(1);
    header.font = { bold: true, size: 11 };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SHEET_HEADER_FILL } };
    header.alignment = { horizontal: "center", vertical: "middle" };
    header.height = 22;
    for (const r of rows) ws.addRow(r);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    sheetsMeta.push({ name, rows: rows.length });
    return ws;
  };

  // 1) شيت المعلومات
  const counts = {
    الموظفون: users.length, الطلاب: students.length, تسجيلات_المجموعات: registrations.length,
    المراحل: grades.length, المواد: subjects.length, المدرسون: teachers.length, المجموعات: groups.length,
    القاعات: rooms.length, الجدول: schedules.length, الحصص: sessions.length, الحضور: attendance.length,
    حركات_الرصيد: transactions.length, المصروفات: expenses.length, مستحقات_المدرسين: settlements.length,
    اليومية: centerTxns.length, الصندوق: cashDays.length, الكتب: books.length, مبيعات_الكتب: bookSales.length,
    الإيصالات: receipts.length, قوالب_واتساب: templates.length, الإعلانات: announcements.length, سجل_العمليات: auditLogs.length,
  };
  addSheet("معلومات النسخة", [
    { header: "البند", key: "k", width: 28 },
    { header: "القيمة", key: "v", width: 46 },
  ], [
    { k: "النظام", v: "AlNokhba Centers — النخبة سنترز" },
    { k: "السنتر", v: center.name },
    { k: "تاريخ النسخة", v: dt(now) },
    { k: "اليوم التشغيلي", v: todayStr() },
    { k: "سبب النسخة", v: reason === "scheduled" ? "تلقائية (الجمعة 22:00 بتوقيت القاهرة)" : "يدوية" },
    { k: "وحدة الفلوس", v: "كل المبالغ بالجنيه المصري (EGP)" },
    { k: "نسخة الصيغة", v: "excel-backup v1" },
    ...Object.entries(counts).map(([k, v]) => ({ k: `عدد ${k}`, v })),
  ]);

  // 2) الموظفون — أعمدة آمنة بس (مفيش باسورد ولا هاش أبدًا)
  addSheet("الموظفون", [
    { header: "الاسم", key: "name", width: 26 },
    { header: "اسم المستخدم", key: "username", width: 18 },
    { header: "الدور", key: "role", width: 14 },
    { header: "الحالة", key: "active", width: 12 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 18 },
  ], users.map((u) => ({ name: u.name, username: u.username, role: u.role === "MANAGER" ? "مدير" : u.role === "RECEPTIONIST" ? "استقبال" : "أدمن", active: u.isActive ? "نشط" : "موقوف", createdAt: dt(u.createdAt) })));

  // 3) الطلاب + الرصيد
  addSheet("الطلاب", [
    { header: "الكود", key: "code", width: 10 },
    { header: "الاسم", key: "name", width: 28 },
    { header: "الصف", key: "grade", width: 18 },
    { header: "موبايل الطالب", key: "phone", width: 16 },
    { header: "ولي الأمر", key: "parentName", width: 20 },
    { header: "موبايل ولي الأمر", key: "parentPhone", width: 16 },
    { header: "المدرسة", key: "school", width: 18 },
    { header: "الحالة", key: "status", width: 12 },
    { header: "الرصيد (جنيه)", key: "balance", width: 14 },
    { header: "ملاحظات", key: "notes", width: 30 },
  ], students.map((s) => ({
    code: s.code, name: s.name,
    grade: s.gradeId ? grades.find((g) => g.id === s.gradeId)?.name ?? "" : "",
    phone: s.phone ?? "", parentName: s.parentName ?? "", parentPhone: s.parentPhone ?? "",
    school: s.school ?? "", status: s.status === "ACTIVE" ? "نشط" : s.status === "PAUSED" ? "متوقف" : "مؤرشف",
    balance: egp(balanceByStudent.get(s.id) ?? 0), notes: s.notes ?? "",
  })));

  // 4) تسجيلات المجموعات
  addSheet("تسجيلات المجموعات", [
    { header: "كود الطالب", key: "code", width: 10 },
    { header: "الطالب", key: "student", width: 26 },
    { header: "المرحلة", key: "grade", width: 16 },
    { header: "المادة", key: "subject", width: 14 },
    { header: "المجموعة", key: "group", width: 10 },
    { header: "السعر الخاص (جنيه)", key: "price", width: 16 },
    { header: "سجّله", key: "by", width: 14 },
  ], registrations.map((r) => ({
    code: r.student.code, student: r.student.name, grade: r.group.grade.name, subject: r.group.subject.name,
    group: r.group.name, price: r.priceOverride != null ? egp(r.priceOverride) : "افتراضي المجموعة", by: r.registeredBy ?? "",
  })));

  // 5) المراحل + المواد
  addSheet("المراحل والمواد", [
    { header: "النوع", key: "type", width: 10 },
    { header: "الاسم", key: "name", width: 24 },
    { header: "الترتيب", key: "order", width: 10 },
  ], [
    ...grades.map((g) => ({ type: "مرحلة", name: g.name, order: g.order })),
    ...subjects.map((s) => ({ type: "مادة", name: s.name, order: "" })),
  ]);

  // 6) المدرسون
  addSheet("المدرسون", [
    { header: "الاسم", key: "name", width: 26 },
    { header: "الموبايل", key: "phone", width: 16 },
    { header: "الحالة", key: "active", width: 10 },
    { header: "ملاحظات", key: "notes", width: 30 },
  ], teachers.map((t) => ({ name: t.name, phone: t.phone ?? "", active: t.isActive ? "نشط" : "موقوف", notes: t.notes ?? "" })));

  // 7) المجموعات
  addSheet("المجموعات", [
    { header: "الاسم", key: "name", width: 10 },
    { header: "المرحلة", key: "grade", width: 16 },
    { header: "المادة", key: "subject", width: 14 },
    { header: "المدرس", key: "teacher", width: 22 },
    { header: "سعر الحصة (جنيه)", key: "price", width: 16 },
    { header: "نسبة المدرس %", key: "pct", width: 12 },
    { header: "القاعة", key: "room", width: 12 },
    { header: "الحالة", key: "active", width: 10 },
  ], groups.map((g) => ({
    name: g.name, grade: g.grade.name, subject: g.subject.name, teacher: g.teacher?.name ?? "—",
    price: egp(g.sessionPrice), pct: g.teacherPercent, room: g.room ?? "", active: g.isActive ? "نشطة" : "موقوفة",
  })));

  // 8) القاعات
  addSheet("القاعات", [
    { header: "الاسم", key: "name", width: 20 },
    { header: "السعة", key: "capacity", width: 10 },
    { header: "الحالة", key: "active", width: 10 },
  ], rooms.map((r) => ({ name: r.name, capacity: r.capacity ?? "", active: r.isActive ? "نشطة" : "موقوفة" })));

  // 9) الجدول الأسبوعي
  addSheet("الجدول الأسبوعي", [
    { header: "اليوم", key: "day", width: 12 },
    { header: "من", key: "start", width: 10 },
    { header: "إلى", key: "end", width: 10 },
    { header: "المرحلة", key: "grade", width: 16 },
    { header: "المادة", key: "subject", width: 14 },
    { header: "المجموعة", key: "group", width: 10 },
    { header: "المدرس", key: "teacher", width: 22 },
    { header: "القاعة", key: "room", width: 12 },
  ], schedules.map((s) => ({
    day: dayAR[s.dayOfWeek], start: s.startTime, end: s.endTime,
    grade: s.group.grade.name, subject: s.group.subject.name, group: s.group.name,
    teacher: s.group.teacher?.name ?? "—", room: s.room ?? "",
  })));

  // 10) الحصص
  addSheet("الحصص", [
    { header: "التاريخ", key: "date", width: 12 },
    { header: "المادة", key: "subject", width: 14 },
    { header: "المرحلة", key: "grade", width: 16 },
    { header: "المجموعة", key: "group", width: 10 },
    { header: "المدرس", key: "teacher", width: 22 },
    { header: "من", key: "start", width: 10 },
    { header: "إلى", key: "end", width: 10 },
    { header: "الحالة", key: "status", width: 10 },
    { header: "الحضور", key: "present", width: 10 },
    { header: "الإيراد (جنيه)", key: "revenue", width: 14 },
    { header: "نصيب المدرس (جنيه)", key: "teacherShare", width: 16 },
    { header: "نصيب السنتر (جنيه)", key: "centerShare", width: 16 },
    { header: "فتحها", key: "openedBy", width: 14 },
  ], sessions.map((s) => ({
    date: s.date, subject: s.group.subject.name, grade: s.group.grade.name, group: s.group.name,
    teacher: s.group.teacher?.name ?? "—", start: s.startTime, end: s.endTime,
    status: statusAR(s.status), present: s.presentCount ?? "", revenue: s.totalRevenue != null ? egp(s.totalRevenue) : "",
    teacherShare: s.teacherShare != null ? egp(s.teacherShare) : "", centerShare: s.centerShare != null ? egp(s.centerShare) : "",
    openedBy: s.openedBy ?? "",
  })));

  // 11) الحضور
  addSheet("الحضور", [
    { header: "تاريخ الحصة", key: "date", width: 12 },
    { header: "المادة", key: "subject", width: 14 },
    { header: "كود الطالب", key: "code", width: 10 },
    { header: "الطالب", key: "student", width: 26 },
    { header: "الحالة", key: "status", width: 10 },
    { header: "المخصوم (جنيه)", key: "charged", width: 14 },
    { header: "سجّله", key: "by", width: 14 },
  ], attendance.map((a) => ({
    date: a.session.date, subject: a.session.group.subject.name, code: a.student.code, student: a.student.name,
    status: a.status === "PRESENT" ? "حاضر" : a.status === "LATE" ? "متأخر" : "بعذر",
    charged: egp(a.charged), by: a.recordedBy ?? "",
  })));

  // 12) الدفعات وحركات الرصيد
  addSheet("الدفعات والرصيد", [
    { header: "التاريخ", key: "date", width: 18 },
    { header: "كود الطالب", key: "code", width: 10 },
    { header: "الطالب", key: "student", width: 26 },
    { header: "النوع", key: "type", width: 12 },
    { header: "المبلغ (جنيه)", key: "amount", width: 14 },
    { header: "الطريقة", key: "method", width: 14 },
    { header: "الرصيد بعدها (جنيه)", key: "balanceAfter", width: 18 },
    { header: "ملاحظة", key: "note", width: 28 },
  ], (() => {
    let running = 0;
    return transactions.map((t) => {
      running += t.amount;
      return {
        date: dt(t.createdAt), code: t.student?.code ?? "", student: t.student?.name ?? "",
        type: txnTypeAR(t.type), amount: egp(t.amount), method: methodAR(t.method),
        balanceAfter: egp(running), note: t.reason ?? "",
      };
    });
  })());

  // 13) المصروفات
  addSheet("المصروفات", [
    { header: "التاريخ", key: "date", width: 12 },
    { header: "البند", key: "category", width: 16 },
    { header: "المبلغ (جنيه)", key: "amount", width: 14 },
    { header: "ملاحظة", key: "note", width: 34 },
  ], expenses.map((e) => ({
    date: e.date,
    category: e.category === "RENT" ? "إيجار" : e.category === "ELECTRICITY" ? "كهرباء" : e.category === "SALARIES" ? "رواتب" : e.category === "MAINTENANCE" ? "صيانة" : e.category === "SUPPLIES" ? "مستلزمات" : "أخرى",
    amount: egp(e.amount), note: e.note ?? "",
  })));

  // 14) مستحقات المدرسين
  addSheet("مستحقات المدرسين", [
    { header: "التاريخ", key: "date", width: 12 },
    { header: "المدرس", key: "teacher", width: 26 },
    { header: "النوع", key: "type", width: 12 },
    { header: "المبلغ (جنيه)", key: "amount", width: 14 },
    { header: "ملاحظة", key: "note", width: 30 },
  ], settlements.map((s) => ({
    date: s.date, teacher: s.teacher.name, type: s.type === "EARNED" ? "مستحق" : "مدفوع",
    amount: egp(Math.abs(s.amount)), note: s.note ?? "",
  })));

  // 15) اليومية
  addSheet("اليومية", [
    { header: "التاريخ", key: "date", width: 12 },
    { header: "النوع", key: "type", width: 20 },
    { header: "المبلغ (جنيه)", key: "amount", width: 14 },
    { header: "المرجع", key: "ref", width: 18 },
    { header: "ملاحظة", key: "note", width: 30 },
  ], centerTxns.map((t) => ({
    date: t.date, type: t.type, amount: egp(t.amount), ref: t.refType ?? "", note: t.note ?? "",
  })));

  // 16) الصندوق
  addSheet("الصندوق", [
    { header: "التاريخ", key: "date", width: 12 },
    { header: "افتتاحي (جنيه)", key: "opening", width: 16 },
    { header: "المعدود (جنيه)", key: "counted", width: 16 },
    { header: "الفرق (جنيه)", key: "diff", width: 14 },
    { header: "الحالة", key: "status", width: 12 },
  ], cashDays.map((c) => ({
    date: c.date, opening: egp(c.openingCash), counted: c.countedCash != null ? egp(c.countedCash) : "",
    diff: c.countedCash != null ? egp(c.countedCash - c.openingCash) : "", status: c.status === "CLOSED" ? "مقفول" : "مفتوح",
  })));

  // 17) الكتب
  addSheet("الكتب", [
    { header: "الكتاب", key: "name", width: 26 },
    { header: "المرحلة", key: "grade", width: 16 },
    { header: "سعر البيع (جنيه)", key: "price", width: 16 },
    { header: "التكلفة (جنيه)", key: "cost", width: 14 },
    { header: "المخزون", key: "stock", width: 10 },
    { header: "الحالة", key: "active", width: 10 },
  ], books.map((b) => ({
    name: b.name, grade: b.gradeId ? (grades.find((g) => g.id === b.gradeId)?.name ?? "") : "",
    price: egp(b.price), cost: egp(b.costPrice), stock: b.stock, active: b.isActive ? "على الرف" : "مؤرشف",
  })));

  // 18) مبيعات الكتب
  addSheet("مبيعات الكتب", [
    { header: "التاريخ", key: "date", width: 12 },
    { header: "الكتاب", key: "book", width: 26 },
    { header: "المشتري", key: "buyer", width: 22 },
    { header: "الكمية", key: "qty", width: 10 },
    { header: "الإجمالي (جنيه)", key: "total", width: 14 },
    { header: "الطريقة", key: "method", width: 14 },
  ], bookSales.map((s) => ({
    date: s.date, book: s.book.name, buyer: s.buyerName ?? "زائر", qty: s.qty,
    total: egp(s.total), method: methodAR(s.method),
  })));

  // 19) الإيصالات
  addSheet("الإيصالات", [
    { header: "الرقم", key: "number", width: 12 },
    { header: "التاريخ", key: "date", width: 12 },
    { header: "كود الطالب", key: "code", width: 10 },
    { header: "الطالب", key: "student", width: 26 },
    { header: "المبلغ (جنيه)", key: "amount", width: 14 },
    { header: "الطريقة", key: "method", width: 14 },
    { header: "أصدرها", key: "by", width: 18 },
  ], receipts.map((r) => ({
    number: r.number, date: r.date, code: r.student?.code ?? "", student: r.student?.name ?? "",
    amount: egp(r.amount), method: methodAR(r.method), by: r.issuedByName ?? "",
  })));

  // 20) قوالب واتساب
  addSheet("قوالب واتساب", [
    { header: "الاسم", key: "name", width: 22 },
    { header: "المحتوى", key: "body", width: 70 },
    { header: "آخر تعديل", key: "updatedAt", width: 18 },
  ], templates.map((t) => ({ name: t.name, body: t.body, updatedAt: dt(t.updatedAt) })));

  // 21) الإعلانات
  addSheet("الإعلانات", [
    { header: "التاريخ", key: "date", width: 18 },
    { header: "العنوان", key: "title", width: 26 },
    { header: "النص", key: "body", width: 60 },
    { header: "المرسل", key: "by", width: 18 },
  ], announcements.map((a) => ({ date: dt(a.createdAt), title: a.title, body: a.body, by: a.createdByName ?? "" })));

  // 22) سجل العمليات
  addSheet("سجل العمليات", [
    { header: "التاريخ", key: "date", width: 18 },
    { header: "المستخدم", key: "user", width: 20 },
    { header: "العملية", key: "action", width: 22 },
    { header: "السبب", key: "reason", width: 40 },
  ], auditLogs.map((a) => ({ date: dt(a.createdAt), user: a.userName, action: a.action, reason: a.reason ?? "" })));

  await mkdir(BACKUP_DIR, { recursive: true });
  await wb.xlsx.writeFile(target);

  // ==== التحقق الآلي بعد الإنشاء (الملف موجود + بيتفتح + الشيتات + الأعداد) ====
  const meta = await validateExcelBackup(file, center.id, center.name, sheetsMeta);
  if (!meta.validated) {
    // النسخة الفاشلة بتحذف — مفيش نسخة «ناجحة» من غير تحقق
    try { await unlink(target); } catch { /* best effort */ }
    throw new Error(`فشل التحقق من نسخة Excel: ${meta.validationError}`);
  }

  // retention للـ xlsx (آخر 7) — وبيحدّث كاش الميتا كمان
  await enforceExcelRetention();

  const finalMeta: ExcelBackupMeta = {
    file, centerId, centerName: center.name, size: meta.size, createdAt: now.toISOString(),
    checksum: meta.checksum, validated: true, sheets: sheetsMeta,
  };
  await upsertExcelMetaCache(finalMeta);

  return finalMeta;
}

/** التحقق من مصنف Excel: موجود + بيتفتح + الشيتات المطلوبة + أعداد الصفوف + checksum */
export async function validateExcelBackup(
  file: string,
  centerId: string,
  centerName: string,
  expectedSheets?: { name: string; rows: number }[],
): Promise<ExcelBackupMeta & { validated: boolean }> {
  const target = path.join(BACKUP_DIR, file);
  const fail = (validationError: string) => ({
    file, centerId, centerName, size: 0, createdAt: new Date().toISOString(),
    checksum: "", validated: false, validationError, sheets: [],
  });

  try {
    await access(target);
  } catch {
    return fail("الملف مش موجود على القرص");
  }

  const st = await stat(target);
  const buf = await readFile(target);
  const checksum = createHash("sha256").update(new Uint8Array(buf)).digest("hex");

  try {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const names = wb.worksheets.map((w) => w.name);
    const REQUIRED = ["معلومات النسخة", "الطلاب", "الدفعات والرصيد", "الحضور", "الحصص", "المصروفات"];
    for (const req of REQUIRED) {
      if (!names.includes(req)) return fail(`شيت مفقود: ${req}`);
    }
    if (expectedSheets) {
      for (const exp of expectedSheets) {
        const ws = wb.getWorksheet(exp.name);
        if (!ws) return fail(`شيت مفقود: ${exp.name}`);
        const actual = ws.rowCount - 1; // بدون الهيدر
        if (actual !== exp.rows) return fail(`عدد صفوف «${exp.name}» غلط: ${actual} بدل ${exp.rows}`);
      }
    }
    return {
      file, centerId, centerName, size: st.size, createdAt: st.mtime.toISOString(),
      checksum, validated: true, sheets: expectedSheets ?? names.map((n) => ({ name: n, rows: (wb.getWorksheet(n)?.rowCount ?? 1) - 1 })),
    };
  } catch (e) {
    return fail(`الملف مش بيتفتح كملف Excel: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * كاش ميتا مصنفات Excel (sidecar) — عشان فتح تاب النسخ يبقى فوري.
 * القايمة كانت بتعيد التحقق من كل ملف (SHA256 + فتح ExcelJS) مع كل GET
 * وبده كان بياخد ثواني مع مصنفات كبيرة → الشاشة بتفضل على سبينر
 * وبتوهم المستخدم إن التاب «مش شغال».
 * الكاش بيتحدّث وقت إنشاء النسخة (بعد التحقق الآلي) وبيتحذف منه
 * الملفات الممسوحة. لو الكاش ناقص/بوظ → fallback: تحقق كامل زي الأول.
 */
async function readExcelMetaCache(): Promise<Record<string, ExcelBackupMeta>> {
  try {
    const raw = await readFile(EXCEL_META_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, ExcelBackupMeta>;
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* أول مرة أو ملف بوظ — نبدأ من الأول */ }
  return {};
}

async function writeExcelMetaCache(cache: Record<string, ExcelBackupMeta>): Promise<void> {
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    await writeFile(EXCEL_META_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch { /* best-effort — الكاش تحسين مش شرط */ }
}

/** إضافة/تحديث مدخل في كاش ميتا Excel */
async function upsertExcelMetaCache(meta: ExcelBackupMeta): Promise<void> {
  const cache = await readExcelMetaCache();
  cache[meta.file] = meta;
  await writeExcelMetaCache(cache);
}

/** تنظيف الكاش من الملفات الممسوحة (بعد الـ retention) */
async function pruneExcelMetaCache(existingFiles: string[]): Promise<void> {
  const cache = await readExcelMetaCache();
  const keep = new Set(existingFiles);
  const before = Object.keys(cache).length;
  for (const f of Object.keys(cache)) {
    if (!keep.has(f)) delete cache[f];
  }
  if (Object.keys(cache).length !== before) await writeExcelMetaCache(cache);
}

async function enforceExcelRetention(): Promise<void> {
  const names = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith("Alnokhba_Backup_") && f.endsWith(".xlsx"));
  const out: { file: string; mtime: number }[] = [];
  for (const name of names) {
    const st = await stat(path.join(BACKUP_DIR, name));
    out.push({ file: name, mtime: st.mtime.getTime() });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  for (const old of out.slice(RETENTION)) {
    try { await unlink(path.join(BACKUP_DIR, old.file)); } catch { /* best effort */ }
  }
  // نضيفّي الكاش من الملفات الممسوحة
  const remaining = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith("Alnokhba_Backup_") && f.endsWith(".xlsx"));
  await pruneExcelMetaCache(remaining);
}

/** قائمة نسخ Excel الحالية — من كاش الميتا فورًا، والملفات الجديدة/المتغيرة بس هي اللي بتتحقق */
export async function listExcelBackups(): Promise<ExcelBackupMeta[]> {
  try {
    const names = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith("Alnokhba_Backup_") && f.endsWith(".xlsx"));
    const out: ExcelBackupMeta[] = [];
    const cache = await readExcelMetaCache();
    let cacheDirty = false;

    for (const name of names.slice(-RETENTION * 2)) {
      const filePath = path.join(BACKUP_DIR, name);
      let st;
      try {
        st = await stat(filePath);
      } catch {
        continue; // الملف اتشال بين الـ readdir والـ stat
      }
      const cached = cache[name];
      // hit: الملف موجود في الكاش وحجمه زي ما اتحقق عليه (الملف immutable بطبيعته — مفيش تعديل بعد الإنشاء)
      if (cached && cached.validated && cached.size === st.size) {
        out.push({ ...cached, size: st.size, createdAt: st.mtime.toISOString() });
        continue;
      }
      // miss: ملف جديد أو كاش قديم — تحقق كامل وضيفه للكاش
      const slug = name.match(/_(.+)\.xlsx$/)?.[1] ?? "";
      const center = await db.center.findUnique({ where: { slug } });
      const meta = await validateExcelBackup(name, center?.id ?? "", center?.name ?? "—");
      out.push({ ...meta, file: name });
      cache[name] = { ...meta, file: name };
      cacheDirty = true;
    }

    // نضيفّي الكاش من ملفات مش موجودة
    const keep = new Set(names);
    for (const f of Object.keys(cache)) {
      if (!keep.has(f)) { delete cache[f]; cacheDirty = true; }
    }
    if (cacheDirty) await writeExcelMetaCache(cache);

    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

/* ============================================================
   المعاينة والاستعادة الموجّهة (من ملف .db)
   - المعاينة: أعداد صفوف كل جدول في النسخة
   - الاستعادة: الصفوف الناقصة في الإنتاج بس (by id) — من غير مسح أي حاجة
   - كل عملية تتسجل في سجل التدقيق من الـ API
============================================================ */

const RESTORE_TABLES = [
  // الترتيب ده FK-safe: الآباء قبل الأبناء
  // (Attendance محتاج SessionInstance — والـ Receipt محتاج StudentTransaction)
  "Student", "SessionInstance", "StudentGroup", "Attendance", "StudentTransaction",
  "Receipt", "Book", "BookSale", "Expense", "TeacherSettlement",
  "CenterTransaction", "CashDay", "WhatsAppTemplate", "Announcement",
] as const;
export type RestoreTable = (typeof RESTORE_TABLES)[number];

export type RestoreRowResult = {
  table: string;
  label: string;
  inserted: number;
  existing: number;
  failed: number;
};

/** أسماء الجداول للعرض بالعربي */
export const RESTORE_TABLES_AR: Record<string, string> = {
  Student: "الطلاب",
  StudentGroup: "تسجيلات المجموعات",
  StudentTransaction: "حركات الرصيد",
  Attendance: "الحضور",
  SessionInstance: "الحصص",
  Receipt: "الإيصالات",
  Expense: "المصروفات",
  TeacherSettlement: "مستحقات المدرسين",
  CenterTransaction: "اليومية",
  CashDay: "الصندوق",
  Book: "الكتب",
  BookSale: "مبيعات الكتب",
  WhatsAppTemplate: "قوالب واتساب",
  Announcement: "الإعلانات",
};

/** معاينة نسخة .db: أعداد صفوف كل جدول + التعرف على السنتر */
export async function previewBackupDb(file: string): Promise<{
  file: string;
  tables: { table: string; label: string; rows: number }[];
  centerName: string | null;
  createdAt: string;
}> {
  const target = path.join(BACKUP_DIR, path.basename(file));
  await access(target); // يرمي لو مش موجود

  const alias = `bak_${Date.now().toString(36)}`;
  await db.$executeRawUnsafe(`ATTACH DATABASE '${target.replace(/'/g, "''")}' AS ${alias}`);
  try {
    const tables: { table: string; label: string; rows: number }[] = [];
    for (const t of RESTORE_TABLES) {
      const r = (await db.$queryRawUnsafe(`SELECT COUNT(*) as c FROM ${alias}.${t}`)) as { c: number | bigint }[];
      tables.push({ table: t, label: RESTORE_TABLES_AR[t] ?? t, rows: Number(r[0].c) });
    }
    const centerRow = (await db.$queryRawUnsafe(`SELECT name, createdAt FROM ${alias}.Center LIMIT 1`).catch(() => [])) as { name?: string; createdAt?: string }[];
    const st = await stat(target);
    return {
      file: path.basename(file),
      tables,
      centerName: (centerRow as { name?: string }[])[0]?.name ?? null,
      createdAt: st.mtime.toISOString(),
    };
  } finally {
    await db.$executeRawUnsafe(`DETACH DATABASE ${alias}`).catch(() => {});
  }
}

/**
 * استعادة موجّهة: الصفوف الموجودة في النسخة والناقصة في الإنتاج بتتضاف.
 * - مفيش أي صف بيتعدل أو بيتشال — بس إضافات
 * - الصفوف الموجودة خلاص بتتحسب «موجودة» (بتفضل زي ما هي)
 * - الصفوف اللي فشلت (مرجع ناقص) بتتحسب «فشلت» — مش بتتخبي كأنها موجودة
 * - العملية idempotent: إعادة تشغيلها = نفس النتيجة
 * - الترتيب FK-safe: الآباء قبل الأبناء مهما كان ترتيب الاختيار
 */
export async function restoreMissingFromDb(
  file: string,
  tables: string[],
): Promise<RestoreRowResult[]> {
  const target = path.join(BACKUP_DIR, path.basename(file));
  await access(target);

  // نحترم ترتيب RESTORE_TABLES (FK-safe) مهما كان ترتيب الاختيار من الواجهة
  const wanted = (RESTORE_TABLES as readonly string[]).filter((t) => tables.includes(t));
  if (wanted.length === 0) throw new Error("اختار جدول واحد على الأقل من الجداول المسموح استعادتها.");

  const alias = `rst_${Date.now().toString(36)}`;
  await db.$executeRawUnsafe(`ATTACH DATABASE '${target.replace(/'/g, "''")}' AS ${alias}`);
  const results: RestoreRowResult[] = [];
  try {
    for (const t of wanted) {
      // الصفوف اللي في النسخة ومش في الإنتاج
      const missing = (await db.$queryRawUnsafe(
        `SELECT b.* FROM ${alias}.${t} b WHERE NOT EXISTS (SELECT 1 FROM main.${t} m WHERE m.id = b.id)`,
      )) as Record<string, unknown>[];
      let inserted = 0;
      let failed = 0;
      for (const row of missing) {
        try {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => "?").join(",");
          const colList = cols.map((c) => `"${c}"`).join(",");
          await db.$executeRawUnsafe(
            `INSERT OR IGNORE INTO main.${t} (${colList}) VALUES (${placeholders})`,
            ...cols.map((c) => row[c]),
          );
          inserted += 1;
        } catch {
          // صف واحد فشل (مرجع ناقص مثلًا) — نكمل الباقي ونحسبه فشل بوضوح
          failed += 1;
        }
      }
      const total = (await db.$queryRawUnsafe(`SELECT COUNT(*) as c FROM ${alias}.${t}`)) as { c: number | bigint }[];
      results.push({
        table: t,
        label: RESTORE_TABLES_AR[t] ?? t,
        inserted,
        existing: Number(total[0].c) - missing.length,
        failed,
      });
    }
  } finally {
    await db.$executeRawUnsafe(`DETACH DATABASE ${alias}`).catch(() => {});
  }
  return results;
}

/* ============================================================
   الجدولة الأسبوعية — الجمعة 22:00 بتوقيت القاهرة
   (حساب DST صح عبر Intl — مصر عندها توقيت صيفي)
============================================================ */

const CAIRO_TZ = "Africa/Cairo";

/** تحويل «ساعة القاهرة المحلية» إلى UTC بدقة (بيتعامل مع DST) */
function cairoToUtc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  let ts = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: CAIRO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(new Date(ts));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const diff = ts - asUTC;
    if (Math.abs(diff) < 60_000) break;
    ts -= diff;
  }
  return new Date(ts);
}

/** آخر لحظة «جمعة 22:00 قاهرة» عدّت (للتعويض لو السيرفر كان نايم وقتها) */
export function lastFriday22CairoPassed(): Date {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO_TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const weekday = get("weekday");
  const dayNum = weekday === "Sun" ? 0 : weekday === "Mon" ? 1 : weekday === "Tue" ? 2 : weekday === "Wed" ? 3 : weekday === "Thu" ? 4 : weekday === "Fri" ? 5 : 6;

  // عدد الأيام من آخر جمعة (بما فيها اليوم لو جمعة)
  const daysSinceFriday = (dayNum - 5 + 7) % 7;
  const fridayDay = day - daysSinceFriday;
  const candidate = cairoToUtc(year, month, fridayDay, 22);
  if (candidate <= now) return candidate;
  // الساعة لسه معملتش 22:00 النهاردة → خد الجمعة اللي فاتت
  const prev = new Date(candidate.getTime() - 7 * 86400000);
  return prev;
}

/** ميعاد الجمية الجاية 22:00 بتوقيت القاهرة */
export function nextFriday22Cairo(): Date {
  const last = lastFriday22CairoPassed();
  return new Date(last.getTime() + 7 * 86400000);
}

/** النسخة الأسبوعية الكاملة: لقطة .db + Excel لكل السنترز النشطة + تحقق */
export async function runWeeklyBackup(trigger: "scheduled" | "manual" | "catch-up"): Promise<{
  dbFile: string;
  excelFiles: { file: string; centerName: string; validated: boolean }[];
}> {
  const { file } = await createBackup("scheduled");
  const centers = await db.center.findMany({ where: { status: "ACTIVE" } });
  const excelFiles: { file: string; centerName: string; validated: boolean }[] = [];
  for (const c of centers) {
    try {
      const meta = await createExcelBackup(c.id, "scheduled");
      excelFiles.push({ file: meta.file, centerName: c.name, validated: true });
    } catch (e) {
      console.error(`[weekly-backup] excel failed for ${c.name}:`, e instanceof Error ? e.message : e);
      excelFiles.push({ file: "—", centerName: c.name, validated: false });
    }
  }
  const status = await readStatus();
  await writeStatus({
    ...status,
    lastWeeklyAt: new Date().toISOString(),
    lastWeeklyTrigger: trigger,
    nextScheduledAt: nextFriday22Cairo().toISOString(),
  });
  return { dbFile: file, excelFiles };
}

/** Full logical export of ONE center's operational data (versioned JSON). */
export async function exportCenterJson(centerId: string): Promise<{
  meta: Record<string, unknown>;
  data: Record<string, unknown[]>;
}> {
  const center = await db.center.findUnique({ where: { id: centerId } });
  if (!center) throw new Error("center not found");

  const [
    students, registrations, grades, subjects, teachers, groups, rooms,
    schedules, sessions, attendance, transactions, expenses, settlements,
    centerTxns, templates, auditLogs, books, bookSales, cashDays, receipts, notifications,
  ] = await Promise.all([
    db.student.findMany({ where: { centerId } }),
    db.studentGroup.findMany({ where: { student: { centerId } } }),
    db.grade.findMany({ where: { centerId } }),
    db.subject.findMany({ where: { centerId } }),
    db.teacher.findMany({ where: { centerId } }),
    db.group.findMany({ where: { centerId } }),
    db.room.findMany({ where: { centerId } }),
    db.scheduleSlot.findMany({ where: { centerId } }),
    db.sessionInstance.findMany({ where: { centerId } }),
    db.attendance.findMany({ where: { centerId } }),
    db.studentTransaction.findMany({ where: { centerId } }),
    db.expense.findMany({ where: { centerId } }),
    db.teacherSettlement.findMany({ where: { centerId } }),
    db.centerTransaction.findMany({ where: { centerId } }),
    db.whatsAppTemplate.findMany({ where: { centerId } }),
    db.auditLog.findMany({ where: { centerId } }),
    db.book.findMany({ where: { centerId } }),
    db.bookSale.findMany({ where: { centerId } }),
    db.cashDay.findMany({ where: { centerId } }),
    db.receipt.findMany({ where: { centerId } }),
    db.notificationAttempt.findMany({ where: { centerId } }),
  ]);

  const data = {
    students, registrations, grades, subjects, teachers, groups, rooms,
    schedules, sessions, attendance, transactions, expenses, settlements,
    centerTxns, templates, auditLogs, books, bookSales, cashDays, receipts, notifications,
  };

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) counts[k] = v.length;

  return {
    meta: {
      format: "nokhba-center-export",
      schemaVersion: 2,
      centerId: center.id,
      centerName: center.name,
      centerSlug: center.slug,
      createdAt: new Date().toISOString(),
      businessDate: todayStr(),
      moneyUnit: "INTEGER_PIASTRES (1 EGP = 100 piastres)",
      counts,
      centerSettings: {
        name: center.name, primaryColor: center.primaryColor, secondaryColor: center.secondaryColor,
        phone: center.phone, whatsapp: center.whatsapp, address: center.address, slogan: center.slogan,
        signature: center.signature,
        waPaymentsEnabled: center.waPaymentsEnabled,
        waLowBalanceEnabled: center.waLowBalanceEnabled,
        waLowBalanceThreshold: center.waLowBalanceThreshold,
      },
    },
    data,
  };
}

/** CSV tables offered for operational readability (Excel-friendly with BOM). */
export const CSV_TABLES = [
  { key: "students", label: "الطلاب" },
  { key: "payments", label: "الدفعات" },
  { key: "attendance", label: "الحضور" },
  { key: "transactions", label: "حركات الرصيد" },
  { key: "expenses", label: "المصروفات" },
  { key: "sessions", label: "الحصص" },
  { key: "books", label: "الكتب" },
  { key: "booksales", label: "مبيعات الكتب" },
  { key: "settlements", label: "مستحقات المدرسين" },
  { key: "audit", label: "سجل العمليات" },
] as const;

export type CsvTableKey = (typeof CSV_TABLES)[number]["key"];

export async function exportCenterCsv(centerId: string, table: CsvTableKey): Promise<{ filename: string; csv: string }> {
  const BOM = "\uFEFF";
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const money = (p: number | null | undefined): string => ((p ?? 0) / 100).toFixed(2);
  const rows = (arr: Record<string, unknown>[], cols: [string, string][]) =>
    BOM + [cols.map((c) => c[1]).join(","), ...arr.map((r) => cols.map((c) => esc(r[c[0]])).join(","))].join("\n");

  switch (table) {
    case "students": {
      const list = await db.student.findMany({ where: { centerId }, orderBy: { code: "asc" } });
      return {
        filename: "students.csv",
        csv: rows(list as unknown as Record<string, unknown>[], [
          ["code", "الكود"], ["name", "الاسم"], ["phone", "موبايل الطالب"], ["parentName", "ولي الأمر"],
          ["parentPhone", "موبايل ولي الأمر"], ["school", "المدرسة"], ["status", "الحالة"], ["createdAt", "تاريخ التسجيل"],
        ]),
      };
    }
    case "payments": {
      const list = await db.studentTransaction.findMany({
        where: { centerId, type: { in: ["PAYMENT", "REFUND"] } },
        orderBy: { createdAt: "desc" },
        include: { student: { select: { name: true, code: true } } },
      });
      const mapped = list.map((t) => ({
        date: t.createdAt, student: t.student?.name ?? "", code: t.student?.code ?? "",
        type: t.type === "PAYMENT" ? "دفع" : "استرداد", amountEGP: money(t.amount),
        method: t.method ?? "", note: t.reason ?? "", by: t.createdBy,
      }));
      return { filename: "payments.csv", csv: rows(mapped, [["date", "التاريخ"], ["student", "الطالب"], ["code", "الكود"], ["type", "النوع"], ["amountEGP", "المبلغ (جنيه)"], ["method", "الطريقة"], ["note", "ملاحظة"], ["by", "بواسطة"]]) };
    }
    case "attendance": {
      const list = await db.attendance.findMany({
        where: { centerId }, orderBy: { createdAt: "desc" },
        include: { student: { select: { name: true, code: true } }, session: { include: { group: { include: { subject: { select: { name: true } } } } } } },
      });
      const mapped = list.map((a) => ({
        date: a.createdAt, student: a.student.name, code: a.student.code,
        subject: a.session.group.subject.name, sessionDate: a.session.date,
        status: a.status === "PRESENT" ? "حاضر" : a.status === "LATE" ? "متأخر" : "بعذر",
        chargedEGP: money(a.charged), by: a.recordedBy ?? "",
      }));
      return { filename: "attendance.csv", csv: rows(mapped, [["date", "تاريخ التسجيل"], ["student", "الطالب"], ["code", "الكود"], ["subject", "المادة"], ["sessionDate", "تاريخ الحصة"], ["status", "الحالة"], ["chargedEGP", "المخصوم (جنيه)"], ["by", "بواسطة"]]) };
    }
    case "transactions": {
      const list = await db.studentTransaction.findMany({
        where: { centerId }, orderBy: { createdAt: "desc" },
        include: { student: { select: { name: true, code: true } } },
      });
      const mapped = list.map((t) => ({
        date: t.createdAt, student: t.student?.name ?? "", code: t.student?.code ?? "",
        type: t.type, amountEGP: money(t.amount), method: t.method ?? "", note: t.reason ?? "", by: t.createdBy,
      }));
      return { filename: "transactions.csv", csv: rows(mapped, [["date", "التاريخ"], ["student", "الطالب"], ["code", "الكود"], ["type", "النوع"], ["amountEGP", "المبلغ (جنيه)"], ["method", "الطريقة"], ["note", "ملاحظة"], ["by", "بواسطة"]]) };
    }
    case "expenses": {
      const list = await db.expense.findMany({ where: { centerId }, orderBy: { date: "desc" } });
      const mapped = list.map((e) => ({ date: e.date, category: e.category, amountEGP: money(e.amount), note: e.note ?? "", by: e.createdBy }));
      return { filename: "expenses.csv", csv: rows(mapped, [["date", "التاريخ"], ["category", "البند"], ["amountEGP", "المبلغ (جنيه)"], ["note", "ملاحظة"], ["by", "بواسطة"]]) };
    }
    case "sessions": {
      const list = await db.sessionInstance.findMany({
        where: { centerId }, orderBy: { date: "desc" },
        include: { group: { include: { subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
      });
      const mapped = list.map((s) => ({
        date: s.date, subject: s.group.subject.name, teacher: s.group.teacher?.name ?? "",
        startTime: s.startTime, endTime: s.endTime, room: s.room ?? "", status: s.status,
        presentCount: s.presentCount ?? "", totalRevenueEGP: money(s.totalRevenue),
        teacherShareEGP: money(s.teacherShare), centerShareEGP: money(s.centerShare),
      }));
      return { filename: "sessions.csv", csv: rows(mapped, [["date", "التاريخ"], ["subject", "المادة"], ["teacher", "المدرس"], ["startTime", "من"], ["endTime", "إلى"], ["room", "القاعة"], ["status", "الحالة"], ["presentCount", "الحضور"], ["totalRevenueEGP", "الإيراد (جنيه)"], ["teacherShareEGP", "نصيب المدرس"], ["centerShareEGP", "نصيب السنتر"]]) };
    }
    case "books": {
      const list = await db.book.findMany({ where: { centerId }, orderBy: { name: "asc" } });
      const mapped = list.map((b) => ({
        name: b.name, priceEGP: money(b.price), costEGP: money(b.costPrice), stock: b.stock,
        reorderThreshold: b.reorderThreshold, isActive: b.isActive ? "على الرف" : "مؤرشف",
      }));
      return { filename: "books.csv", csv: rows(mapped, [["name", "الكتاب"], ["priceEGP", "سعر البيع"], ["costEGP", "التكلفة"], ["stock", "المخزون"], ["reorderThreshold", "حد التنبيه"], ["isActive", "الحالة"]]) };
    }
    case "booksales": {
      const list = await db.bookSale.findMany({ where: { centerId }, orderBy: { createdAt: "desc" }, include: { book: { select: { name: true } } } });
      const mapped = list.map((s) => ({
        date: s.date, book: s.book.name, buyer: s.buyerName ?? "", qty: s.qty,
        unitPriceEGP: money(s.unitPrice), totalEGP: money(s.total), method: s.method ?? "", by: s.createdBy,
      }));
      return { filename: "booksales.csv", csv: rows(mapped, [["date", "التاريخ"], ["book", "الكتاب"], ["buyer", "المشتري"], ["qty", "الكمية"], ["unitPriceEGP", "سعر النسخة"], ["totalEGP", "الإجمالي"], ["method", "الطريقة"], ["by", "بواسطة"]]) };
    }
    case "settlements": {
      const list = await db.teacherSettlement.findMany({
        where: { centerId }, orderBy: { date: "desc" },
        include: { teacher: { select: { name: true } } },
      });
      const mapped = list.map((s) => ({
        date: s.date, teacher: s.teacher.name, type: s.type === "EARNED" ? "مستحق" : "مدفوع",
        amountEGP: money(s.amount), note: s.note ?? "", by: s.createdBy,
      }));
      return { filename: "settlements.csv", csv: rows(mapped, [["date", "التاريخ"], ["teacher", "المدرس"], ["type", "النوع"], ["amountEGP", "المبلغ (جنيه)"], ["note", "ملاحظة"], ["by", "بواسطة"]]) };
    }
    case "audit": {
      const list = await db.auditLog.findMany({ where: { centerId }, orderBy: { createdAt: "desc" } });
      const mapped = list.map((a) => ({ date: a.createdAt, user: a.userName, action: a.action, entity: a.entity ?? "", entityId: a.entityId ?? "" }));
      return { filename: "audit.csv", csv: rows(mapped, [["date", "التاريخ"], ["user", "المستخدم"], ["action", "العملية"], ["entity", "النوع"], ["entityId", "المعرف"]]) };
    }
  }
}
