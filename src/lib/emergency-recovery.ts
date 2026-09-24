import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { verifyLicenseRaw, canonicalJson, type EmergencyLicense } from "@/lib/emergency-license";
import { studentBalance } from "@/lib/finance";
import { logAudit, AUDIT } from "@/lib/audit";

// ============================================================
// محرك استيراد ملف الاسترداد (نظام الطوارئ HTML).
// مبادئ (القسم 22-24 من المواصفة):
// 1) السيرفر هو المرجع — كل حاجة بتتحقق تاني مهما كان الملف.
// 2) مفيش مسح/استبدال — إضافة معاملات بس (transaction-based).
// 3) التكرار مستحيل (ETX ids مسجّلة).
// 4) التعارض بيتعرض للمدير وبيقرر هو.
// ============================================================

const ETX_ID_RE = /^ETX-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPS = new Set([
  "PAYMENT_RECORDED", "SUBSCRIPTION_RENEWED", "BALANCE_UPDATED",
  "ATTENDANCE_RECORDED", "ATTENDANCE_UPDATED",
  "SESSION_STARTED", "SESSION_ENDED", "SESSION_CANCELLED",
  "STUDENT_ADDED", "STUDENT_UPDATED",
]);
const AR_STATUS: Record<string, string> = {
  PAYMENT_RECORDED: "دفعة", SUBSCRIPTION_RENEWED: "تجديد اشتراك", BALANCE_UPDATED: "تسوية رصيد",
  ATTENDANCE_RECORDED: "تسجيل حضور", ATTENDANCE_UPDATED: "تعديل حضور",
  SESSION_STARTED: "بدء حصة", SESSION_ENDED: "قفل حصة", SESSION_CANCELLED: "إلغاء حصة",
  STUDENT_ADDED: "طالب جديد", STUDENT_UPDATED: "تعديل طالب",
};

export type RecoveryTxn = {
  id: string; packageId: string; centerId: string; seq: number; ts: string;
  actor: string; actorId: string | null; actorRole: string;
  op: string; entityType: string; entityId: string | null;
  prev: Record<string, unknown> | null; next: Record<string, unknown> | null;
  payload: Record<string, unknown> | null; sum?: string;
};

export type RecoveryPkg = {
  v: number; typ: string; centerId: string; centerName?: string;
  packageId: string; snapshotId?: string; exportedAt?: string;
  license: string; signature: string; txns: RecoveryTxn[];
};

export type ConflictItem = {
  txnId: string; seq: number; op: string; opAr: string;
  entity: string; entityName: string; field: string;
  offlineValue: string; onlineValue: string; ts: string;
  suggestion: string; code: string;
};

type ManagerUser = SessionUser & { centerId: string };

type Analysis = {
  license: EmergencyLicense;
  valid: RecoveryTxn[];
  duplicates: { txnId: string; reason: string }[];
  invalid: { txnId: string; reason: string }[];
  conflicts: ConflictItem[];
  // خرايط التطبيق
  studentMap: Map<string, { id: string; code: string; name: string; created: boolean }>;
  sessionMap: Map<string, { id: string | null; groupId: string; date: string; startTime: string; status?: string; create: boolean }>;
  total: number;
};

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
function egp(p: number): string {
  return ((p || 0) / 100).toFixed(2);
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** التحليل الكامل للملف — preview و commit بيمرّوا بنفس المسار ده (المرجع واحد) */
export async function analyzeRecovery(user: ManagerUser, pkg: RecoveryPkg): Promise<Analysis> {
  // ===== 1) البنية =====
  if (!pkg || typeof pkg !== "object" || !Array.isArray(pkg.txns)) throw new ApiError("ملف الاسترداد مش مكتوب صح.", 400);
  if (pkg.txns.length > 20000) throw new ApiError("الملف فيه عمليات كتير بشكل غير منطقي.", 400);
  if (!pkg.license || !pkg.signature) throw new ApiError("الملف من غير رخصة موقّعة.", 400);

  // ===== 2) التوقيع =====
  const license = verifyLicenseRaw(String(pkg.license), String(pkg.signature));
  if (!license) throw new ApiError("توقيع الرخصة مش صحيح — الملف اتعدّل أو ملف مصنع.", 400);
  if (license.centerId !== user.centerId) {
    throw new ApiError("الحزمة دي مصدرة لسنتر تاني — مش هتنفع هنا.", 403);
  }
  if (pkg.packageId !== license.packageId) throw new ApiError("معرف الحزمة في الملف مش مطابق للرخصة.", 400);

  // ===== 3) سجل الحزم الصادرة من السيرفر =====
  const packageRow = await db.emergencyPackage.findUnique({ where: { id: license.packageId } });
  if (!packageRow) throw new ApiError("الحزمة دي مش مسجّلة كمصدرة من السيرفر.", 403);
  if (packageRow.centerId !== user.centerId) throw new ApiError("الحزمة دي لسنتر تاني.", 403);
  if (packageRow.revokedAt) throw new ApiError("الحزمة دي اتلغت من الإدارة.", 403);
  if (packageRow.signature !== pkg.signature) throw new ApiError("توقيع الحزمة مش مطابق لسجل السيرفر.", 400);

  const issued = new Date(license.issuedAt).getTime();
  const expires = new Date(license.expiresAt).getTime();

  // ===== 4) المستورد قبل كده =====
  const importedIds = new Set(
    (await db.emergencyImportedTxn.findMany({
      where: { packageId: license.packageId },
      select: { id: true },
    })).map((t) => t.id),
  );

  // ===== 5) الطلاب/الحصص الحالية (للكيانات والحالات) =====
  const [students, groups, sessions] = await Promise.all([
    db.student.findMany({
      where: { centerId: user.centerId },
      select: { id: true, code: true, name: true, phone: true, parentPhone: true, status: true },
    }),
    db.group.findMany({ where: { centerId: user.centerId }, select: { id: true, sessionPrice: true, teacherPercent: true, teacherId: true, isActive: true } }),
    db.sessionInstance.findMany({
      where: { centerId: user.centerId, date: { gte: new Date(issued - 8 * 86400000).toISOString().slice(0, 10) } },
      select: { id: true, groupId: true, date: true, startTime: true, status: true, presentCount: true, totalRevenue: true },
    }),
  ]);
  const studentByCode = new Map(students.map((s) => [s.code, s]));
  const sessionByKey = new Map<string, typeof sessions[number]>();
  for (const s of sessions) sessionByKey.set(s.groupId + "|" + s.date + "|" + s.startTime, s);
  const balancesOnline = new Map<string, number>();
  {
    const ids = pkg.txns.map((t) => String(t.entityId || ""));
    const byId = new Map(students.map((s) => [s.id, s]));
    const need = new Set<string>();
    for (const t of pkg.txns) {
      const sid = t.entityType === "STUDENT" ? String(t.entityId || "") : t.payload && typeof t.payload.studentId === "string" ? (t.payload.studentId as string) : "";
      if (sid && byId.has(sid)) need.add(sid);
    }
    void ids;
    for (const sid of need) {
      const s = byId.get(sid);
      if (s) balancesOnline.set(sid, await studentBalance(sid));
    }
  }

  const analysis: Analysis = {
    license,
    valid: [],
    duplicates: [],
    invalid: [],
    conflicts: [],
    studentMap: new Map(),
    sessionMap: new Map(),
    total: pkg.txns.length,
  };

  // طلاب من اللقطة بنفس الـ IDs — خريطة مباشرة + اللي هيتضاف من الملف
  const snapshotStudents = await db.student.findMany({
    where: { centerId: user.centerId },
    select: { id: true, code: true, name: true },
  });
  for (const s of snapshotStudents) analysis.studentMap.set(s.id, { id: s.id, code: s.code, name: s.name, created: false });

  // مرتبة بالتسلسل — الترتيب بيحدد إمكانية حل الكيانات المضافة محليًا
  const ordered = [...pkg.txns].sort((a, b) => num(a.seq) - num(b.seq));
  const seenIds = new Set<string>();
  const seenSeqs = new Set<number>();

  for (const t of ordered) {
    const why = (reason: string) => analysis.invalid.push({ txnId: String(t.id || "—"), reason });
    const conflict = (c: Partial<ConflictItem> & { code: string }) => {
      analysis.conflicts.push({
        txnId: String(t.id), seq: num(t.seq) || 0, op: String(t.op), opAr: AR_STATUS[String(t.op)] || String(t.op),
        entity: "", entityName: "", field: c.field || "", offlineValue: c.offlineValue ?? "—",
        onlineValue: c.onlineValue ?? "—", ts: String(t.ts || ""), suggestion: c.suggestion || "راجع وقرر",
        code: c.code,
      });
    };

    // ===== فحوصات شكلية =====
    if (typeof t.id !== "string" || !ETX_ID_RE.test(t.id)) { why("كود العملية مش بصيغة ETX سليمة"); continue; }
    if (seenIds.has(t.id)) { why("كود العملية مكرر جوّه الملف نفسه"); continue; }
    seenIds.add(t.id);
    if (t.packageId !== license.packageId || t.centerId !== license.centerId) { why("العملية مرتبطة بحزمة/سنتر مختلف"); continue; }
    if (!Number.isFinite(num(t.seq)) || num(t.seq) < 1) { why("رقم التسلسل مش سليم"); continue; }
    if (seenSeqs.has(num(t.seq))) { why("رقم التسلسل مكرر"); continue; }
    seenSeqs.add(num(t.seq));
    if (!OPS.has(String(t.op))) { why(`نوع عملية غير معروف: ${String(t.op)}`); continue; }

    // ===== فحص السلامة (checksum) =====
    const tAny = t as unknown as Record<string, unknown>;
    const sumless: Record<string, unknown> = {};
    for (const k of Object.keys(tAny).sort()) if (k !== "sum") sumless[k] = tAny[k];
    const expectedSum = sha256(canonicalJson(sumless));
    if (t.sum !== expectedSum) { why("مجموع التحقق مش مطابق — المعاملة اتعدّلت"); continue; }

    // ===== نافذة الزمن =====
    const ts = Date.parse(String(t.ts || ""));
    if (!Number.isFinite(ts) || ts < issued - 6 * 3600 * 1000 || ts > expires + 6 * 3600 * 1000) {
      why("توقيت العملية خارج نافذة رخصة الطوارئ"); continue;
    }

    // ===== مستوردة قبل كده =====
    if (importedIds.has(t.id)) {
      analysis.duplicates.push({ txnId: t.id, reason: "اتزامنت قبل كده" });
      continue;
    }

    const p = (t.payload || {}) as Record<string, unknown>;
    const prev = (t.prev || {}) as Record<string, unknown>;
    const op = String(t.op);

    // ===== حل الكيانات + فحوصات التعارض حسب النوع =====
    if (op === "STUDENT_ADDED") {
      const code = String(p.code || "");
      const name = String(p.name || "");
      if (!/^\d{5}$/.test(code)) { why("كود الطالب مش 5 أرقام"); continue; }
      if (!name || name.length < 3) { why("اسم الطالب غير سليم"); continue; }
      const exists = studentByCode.get(code);
      if (exists) {
        conflict({ code: "STUDENT_CODE_TAKEN", field: "كود الطالب", offlineValue: `${code} — ${name}`, onlineValue: `${exists.code} — ${exists.name}`, suggestion: "الطالب موجود بالكود ده أونلاين — اسكب لو نفس الشخص، أو طبّق لو شخص تاني (هيتولّدله كود جديد)" });
        analysis.studentMap.set(t.entityId || code, { id: exists.id, code: exists.code, name: exists.name, created: false });
        continue;
      }
      analysis.valid.push(t);
      analysis.studentMap.set(String(t.entityId || ""), { id: String(t.entityId || ""), code, name, created: true });
      continue;
    }

    if (op === "STUDENT_UPDATED") {
      const sid = analysis.studentMap.get(String(t.entityId || ""));
      if (!sid || sid.created) { why("الطالب مش موجود في اللقطة/الملف"); continue; }
      const online = await db.student.findUnique({ where: { id: sid.id }, select: { phone: true, parentPhone: true } });
      if (!online) { why("الطالب مش موجود أونلاين"); continue; }
      const prevPhone = String(prev.phone ?? "") || null;
      const onlinePhone = online.phone ?? "";
      if ((prevPhone || "") !== onlinePhone) {
        conflict({ code: "CONTACT_CHANGED", entity: "طالب", entityName: sid.name, field: "موبايل الطالب", offlineValue: prevPhone || "—", onlineValue: onlinePhone || "—", suggestion: "الرقم اتغير أونلاين بعد اللقطة — طبّق = يستخدم رقم الطوارئ" });
        continue;
      }
      analysis.valid.push(t);
      continue;
    }

    if (op === "PAYMENT_RECORDED" || op === "SUBSCRIPTION_RENEWED" || op === "BALANCE_UPDATED") {
      const amount = num(p.amount);
      if (!Number.isFinite(amount) || amount === 0) { why("مبلغ غير سليم"); continue; }
      const cap = op === "BALANCE_UPDATED" ? 2_000_000 : 10_000_000;
      if (Math.abs(amount) > cap) { why("مبلغ كبير بشكل غير منطقي"); continue; }
      const sid = analysis.studentMap.get(String(t.entityId || ""));
      if (!sid) { why("الطالب مش موجود"); continue; }
      const online = sid.created ? (balancesOnline.get(sid.id) ?? 0) : await studentBalance(sid.id);
      const offlineBefore = num(p.balanceBefore);
      if (Number.isFinite(offlineBefore) && !sid.created && online !== offlineBefore) {
        conflict({
          code: "BALANCE_CHANGED", entity: "طالب", entityName: sid.name, field: "الرصيد قبل العملية",
          offlineValue: egp(offlineBefore) + " ج", onlineValue: egp(online) + " ج",
          suggestion: "الرصيد اتغير أونلاين بعد اللقطة — طبّق = العملية تتفضل زي ما هي على الرصيد الحالي، اسكب = تستثنى",
        });
        continue;
      }
      if (op !== "BALANCE_UPDATED" && (num(p.paid) < 0 || num(p.paid) > 10_000_000)) { why("المبلغ المدفوع غير سليم"); continue; }
      analysis.valid.push(t);
      continue;
    }

    if (op === "ATTENDANCE_RECORDED" || op === "ATTENDANCE_UPDATED") {
      const charge = num(p.charge);
      if (!Number.isFinite(charge) || charge < 0 || charge > 1_000_000) { why("قيمة الخصم غير سليمة"); continue; }
      const sInfo = analysis.studentMap.get(String(p.studentId || ""));
      if (!sInfo) { why("الطالب مش موجود"); continue; }
      const sesInfo = analysis.sessionMap.get(String(p.sessionId || ""));
      if (!sesInfo) { why("الحصة مش موجودة"); continue; }
      const status = String(p.status || "");
      if (!["PRESENT", "LATE", "EXCUSED", "ABSENT"].includes(status)) { why("حالة حضور غير معروفة"); continue; }

      if (!sesInfo.create && sesInfo.id) {
        const attOnline = await db.attendance.findUnique({
          where: { sessionId_studentId: { sessionId: sesInfo.id, studentId: sInfo.id } },
          select: { idemKey: true, status: true, charged: true },
        });
        if (attOnline && attOnline.idemKey === t.id) {
          analysis.duplicates.push({ txnId: t.id, reason: "الحضور ده متزامن خلاص" });
          continue;
        }
        if (attOnline && attOnline.idemKey && attOnline.idemKey !== t.id) {
          conflict({
            code: "ATTENDANCE_EXISTS", entity: "حضور", entityName: sInfo.name, field: "حالة الحضور",
            offlineValue: status, onlineValue: attOnline.status || "—",
            suggestion: "الطالب متسجل أونلاين بحالة تانية — طبّق = الحالة الجاية تعلّي، اسكب = القديمة تفضل",
          });
          continue;
        }
      }
      analysis.valid.push(t);
      continue;
    }

    if (op === "SESSION_STARTED" || op === "SESSION_ENDED" || op === "SESSION_CANCELLED") {
      const groupId = String(p.groupId || "");
      const date = String(p.date || "");
      const startTime = String(p.startTime || "");
      const g = groups.find((x) => x.id === groupId);
      if (!g || !g.isActive) { why("المجموعة مش موجودة/موقوفة"); continue; }
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || date < license.issuedAt.slice(0, 10) || date > license.expiresAt.slice(0, 10)) { why("تاريخ الحصة خارج نافذة الطوارئ"); continue; }
      const key = groupId + "|" + date + "|" + startTime;
      let online = sessionByKey.get(key);
      if (!online && String(t.entityId).startsWith("S-")) {
        online = sessions.find((s) => s.id === String(t.entityId).slice(2)) || undefined;
      }

      if (op === "SESSION_STARTED") {
        if (online && online.status === "CLOSED") {
          conflict({ code: "SESSION_STATE", entity: "حصة", entityName: date + " " + startTime, field: "حالة الحصة", offlineValue: "بدء/شغّالة", onlineValue: "متقفلة أونلاين", suggestion: "الحصة اتقفلت أونلاين — اسكب لو الاتنين نفس الحصة، أو راجع" });
          analysis.sessionMap.set(String(t.entityId), { id: online.id, groupId, date, startTime, status: online.status, create: false });
          continue;
        }
        analysis.sessionMap.set(String(t.entityId), { id: online ? online.id : null, groupId, date, startTime, status: online?.status, create: !online });
        analysis.valid.push(t);
        continue;
      }
      if (op === "SESSION_ENDED") {
        if (online && online.status === "CLOSED") {
          const hasMark = await db.emergencyImportedTxn.findUnique({ where: { id: t.id } });
          if (hasMark) { analysis.duplicates.push({ txnId: t.id, reason: "القفل ده متزامن خلاص" }); continue; }
          conflict({
            code: "SESSION_CLOSED", entity: "حصة", entityName: date + " " + startTime, field: "تجميعات القفل",
            offlineValue: `حضور ${num(p.presentCount)} · إيراد ${egp(num(p.totalRevenue))} ج`,
            onlineValue: `حضور ${online.presentCount ?? 0} · إيراد ${egp(online.totalRevenue ?? 0)} ج`,
            suggestion: "الحصة متقفلة أونلاين بأرقام تانية — راجع الفرق قبل ما تطبق",
          });
          analysis.sessionMap.set(String(t.entityId), { id: online.id, groupId, date, startTime, status: online.status, create: false });
          continue;
        }
        analysis.sessionMap.set(String(t.entityId), { id: online ? online.id : null, groupId, date, startTime, status: online?.status, create: !online });
        analysis.valid.push(t);
        continue;
      }
      // SESSION_CANCELLED
      if (online && online.status === "CLOSED") {
        conflict({ code: "SESSION_STATE", entity: "حصة", entityName: date + " " + startTime, field: "حالة الحصة", offlineValue: "إلغاء", onlineValue: "متقفلة أونلاين", suggestion: "الحصة متقفلة أونلاين — الإلغاء مش منطقي، اسكب" });
        analysis.sessionMap.set(String(t.entityId), { id: online.id, groupId, date, startTime, status: online.status, create: false });
        continue;
      }
      analysis.sessionMap.set(String(t.entityId), { id: online ? online.id : null, groupId, date, startTime, status: online?.status, create: !online });
      analysis.valid.push(t);
      continue;
    }

    why("نوع عملية غير مدعوم");
  }

  return analysis;
}

/** معاينة الاستيراد */
export async function previewRecovery(user: ManagerUser, pkg: RecoveryPkg) {
  const a = await analyzeRecovery(user, pkg);
  const collected = a.valid
    .filter((t) => t.op === "PAYMENT_RECORDED" || t.op === "SUBSCRIPTION_RENEWED")
    .reduce((acc, t) => acc + num((t.payload as Record<string, unknown>)?.amount), 0);
  return {
    packageId: a.license.packageId,
    centerName: a.license.centerName,
    period: { from: a.license.issuedAt, to: a.license.expiresAt },
    exportedAt: pkg.exportedAt ?? null,
    totalTxns: a.total,
    valid: a.valid.length,
    duplicates: a.duplicates.length,
    conflicts: a.conflicts.length,
    invalid: a.invalid.length,
    collected,
    preview: {
      valid: a.valid.slice(0, 12).map((t) => ({
        txnId: t.id, seq: t.seq, op: AR_STATUS[t.op] || t.op,
        actor: t.actor, amount: num((t.payload as Record<string, unknown>)?.amount) || null,
        ts: t.ts,
      })),
      conflicts: a.conflicts.slice(0, 50),
      invalid: a.invalid.slice(0, 12),
    },
    message:
      a.total === 0 ? "الملف سليم بس مفيش معاملات فيه." :
      `تمام — ${a.valid.length} معاملة جاهزة${a.duplicates.length ? ` · ${a.duplicates.length} متكررة (هتتخطى)` : ""}${a.conflicts.length ? ` · ${a.conflicts.length} تعارض محتاج قرارك` : ""}${a.invalid.length ? ` · ${a.invalid.length} مرفوضة (سلامة/صيغة)` : ""}.`,
  };
}

/** التنفيذ الفعلي — valid كله + التعارضات اللي المدير قال «طبّق» */
export async function commitRecovery(
  user: ManagerUser,
  pkg: RecoveryPkg,
  decisions: Record<string, string>,
): Promise<{ imported: number; duplicates: number; conflicts: number; skipped: number; message: string; conflictDetails: unknown[] }> {
  const a = await analyzeRecovery(user, pkg);

  // المعاملات اللي هتتطبق: valid + conflicts المصرّح بيها "apply"
  const conflictById = new Map(a.conflicts.map((c) => [c.txnId, c]));
  const toApply: RecoveryTxn[] = [];
  let skipped = 0;
  for (const t of a.valid) toApply.push(t);
  for (const t of pkg.txns) {
    const c = conflictById.get(String(t.id));
    if (c && decisions[String(t.id)] === "apply") toApply.push(t);
    else if (c) skipped++;
  }
  toApply.sort((x, y) => num(x.seq) - num(y.seq));

  // سجل الاستيراد (يبدأ العد)
  const importRow = await db.emergencyRecoveryImport.create({
    data: {
      centerId: user.centerId,
      packageId: a.license.packageId,
      fileName: `استرداد ${a.license.packageId}`,
      totalTxns: a.total,
      imported: 0, duplicates: a.duplicates.length, conflicts: a.conflicts.length, skipped: 0,
      importedBy: user.id, importedByName: user.name,
    },
  });

  let imported = 0;
  const appliedIds: string[] = [];
  const conflictDetails: unknown[] = [];
  const txnMap = new Map(pkg.txns.map((t) => [String(t.id), t]));

  // خريطة الحصص/الطلاب بتتحل أثناء التطبيق بالترتيب
  const studentMap = new Map(a.studentMap);
  const sessionMap = new Map(a.sessionMap);

  for (const t of toApply) {
    try {
      const op = String(t.op);
      const p = (t.payload || {}) as Record<string, unknown>;
      const prev = (t.prev || {}) as Record<string, unknown>;

      if (op === "STUDENT_ADDED") {
        const { generateQrToken } = await import("@/lib/auth");
        let code = String(p.code || "");
        const exists = await db.student.findUnique({ where: { centerId_code: { centerId: user.centerId, code } } });
        if (exists) {
          // طبّق رغم تعارض الكود → كود جديد
          for (let i = 10001; i < 99999; i++) {
            const c = String(i);
            if (!(await db.student.findUnique({ where: { centerId_code: { centerId: user.centerId, code: c } } }))) { code = c; break; }
          }
        }
        const student = await db.student.create({
          data: {
            centerId: user.centerId, code,
            qrToken: generateQrToken(),
            name: String(p.name || ""), phone: (p.phone as string) || null, parentPhone: (p.parentPhone as string) || null,
            gradeId: (p.gradeId as string) || null,
          },
        });
        if (p.groupId) {
          const g = await db.group.findUnique({ where: { id: String(p.groupId) } });
          if (g) await db.studentGroup.create({ data: { studentId: student.id, groupId: g.id, registeredBy: user.id } }).catch(() => {});
        }
        studentMap.set(String(t.entityId || ""), { id: student.id, code, name: student.name, created: false });
        appliedIds.push(t.id); imported++;
        continue;
      }

      if (op === "STUDENT_UPDATED") {
        const sInfo = studentMap.get(String(t.entityId || ""));
        if (sInfo && !sInfo.created) {
          await db.student.update({
            where: { id: sInfo.id },
            data: { phone: (p.phone as string) || null, parentPhone: (p.parentPhone as string) || null },
          });
        }
        appliedIds.push(t.id); imported++;
        continue;
      }

      if (op === "PAYMENT_RECORDED" || op === "SUBSCRIPTION_RENEWED" || op === "BALANCE_UPDATED") {
        const sInfo = studentMap.get(String(t.entityId || ""));
        if (!sInfo) throw new Error("الطالب مش موجود");
        const isAdjustment = op === "BALANCE_UPDATED";
        const type = isAdjustment ? "ADJUSTMENT" : "PAYMENT";
        const amount = isAdjustment ? num(p.amount) : Math.abs(num(p.amount));
        const signed = isAdjustment ? num(p.amount) : Math.abs(num(p.amount));
        const balanceBefore = await studentBalance(sInfo.id);
        const created = await db.$transaction(async (tx) => {
          const createdTxn = await tx.studentTransaction.create({
            data: {
              centerId: user.centerId, studentId: sInfo.id,
              sessionId: null, type, amount: signed,
              method: isAdjustment ? null : (String(p.method || "CASH") || "CASH"),
              reason: isAdjustment
                ? `تسوية طوارئ: ${String(p.reason || "")} (${t.id})`
                : `${op === "SUBSCRIPTION_RENEWED" ? "تجديد اشتراك طوارئ" : "دفعة طوارئ"}${p.note ? ` — ${String(p.note)}` : ""} (${t.id})`,
              idemKey: t.id, createdBy: user.id,
            },
          });
          let receipt: { id: string; number: string } | null = null;
          if (!isAdjustment) {
            const last = await tx.receipt.findFirst({ where: { centerId: user.centerId }, orderBy: { seq: "desc" }, select: { seq: true } });
            const seq = (last?.seq ?? 0) + 1;
            const r = await tx.receipt.create({
              data: {
                centerId: user.centerId, seq, number: `RC-${String(seq).padStart(6, "0")}`,
                txnId: createdTxn.id, studentId: sInfo.id, amount: signed,
                method: String(p.method || "CASH") || "CASH",
                balanceBefore, balanceAfter: balanceBefore + signed,
                issuedBy: user.id, issuedByName: user.name, date: String(p.date || t.ts.slice(0, 10)),
              },
            });
            receipt = { id: r.id, number: r.number };
          }
          return { txn: createdTxn, receipt };
        });
        void created;
        appliedIds.push(t.id); imported++;
        continue;
      }

      if (op === "ATTENDANCE_RECORDED" || op === "ATTENDANCE_UPDATED") {
        const sInfo = studentMap.get(String(p.studentId || ""));
        const sesInfo = sessionMap.get(String(p.sessionId || ""));
        if (!sInfo) throw new Error("الطالب مش موجود");
        const status = String(p.status || "");
        const charge = num(p.charge);

        // الحصة: موجودة أونلاين أو تتولد
        let sessionId: string | null = sesInfo?.id ?? null;
        if (!sessionId && sesInfo) {
          const g = await db.group.findUnique({ where: { id: sesInfo.groupId }, select: { sessionPrice: true, teacherPercent: true } });
          const created = await db.sessionInstance.create({
            data: {
              centerId: user.centerId, groupId: sesInfo.groupId, date: sesInfo.date,
              startTime: sesInfo.startTime, endTime: "00:00",
              price: g?.sessionPrice ?? 0, teacherPercent: g?.teacherPercent ?? 50,
              status: "OPEN", openedBy: user.id,
            },
          });
          sessionId = created.id;
          sessionMap.set(String(p.sessionId), { ...sesInfo, id: created.id, create: false });
        }
        if (!sessionId) throw new Error("الحصة مش متعرّفة");

        if (status === "ABSENT") {
          // الغياب أونلاين = عدم وجود سجل — لو في سجل قديم من نفس الاستيراد نشيله ونرجّع الخصم
          const old = await db.attendance.findUnique({ where: { sessionId_studentId: { sessionId, studentId: sInfo.id } }, select: { id: true, idemKey: true, charged: true } });
          if (old && old.idemKey && old.idemKey.startsWith("ETX-")) {
            await db.$transaction(async (tx) => {
              await tx.attendance.delete({ where: { id: old.id } });
              if (old.charged) {
                await tx.studentTransaction.create({
                  data: { centerId: user.centerId, studentId: sInfo.id, sessionId, type: "ADJUSTMENT", amount: old.charged, reason: `إلغاء خصم غياب طوارئ (${t.id})`, idemKey: `chg-${t.id}`, createdBy: user.id },
                });
              }
            });
          }
          appliedIds.push(t.id); imported++;
          continue;
        }

        const existing = await db.attendance.findUnique({ where: { sessionId_studentId: { sessionId, studentId: sInfo.id } }, select: { id: true, idemKey: true, charged: true } });
        await db.$transaction(async (tx) => {
          if (existing) {
            const oldCharged = existing.charged ?? 0;
            await tx.attendance.update({
              where: { id: existing.id },
              data: { status, charged: charge, idemKey: t.id, recordedBy: user.id, note: `طوارئ ${t.id}` },
            });
            const delta = oldCharged - charge;
            if (delta !== 0) {
              await tx.studentTransaction.create({
                data: { centerId: user.centerId, studentId: sInfo.id, sessionId, type: "ADJUSTMENT", amount: delta, reason: `تصحيح خصم حضور طوارئ (${t.id})`, idemKey: `chg-${t.id}`, createdBy: user.id },
              });
            }
          } else {
            await tx.attendance.create({
              data: { centerId: user.centerId, sessionId, studentId: sInfo.id, status, charged: charge, idemKey: t.id, recordedBy: user.id, note: `طوارئ ${t.id}` },
            });
            if (charge > 0) {
              await tx.studentTransaction.create({
                data: { centerId: user.centerId, studentId: sInfo.id, sessionId, type: "CHARGE", amount: -charge, reason: `حضور طوارئ (${t.id})`, idemKey: `chg-${t.id}`, createdBy: user.id },
              });
            }
          }
        });
        appliedIds.push(t.id); imported++;
        continue;
      }

      if (op === "SESSION_STARTED") {
        const sesInfo = sessionMap.get(String(t.entityId || ""));
        if (!sesInfo) throw new Error("الحصة مش متعرّفة");
        if (sesInfo.create || !sesInfo.id) {
          const g = await db.group.findUnique({ where: { id: sesInfo.groupId }, select: { sessionPrice: true, teacherPercent: true } });
          const created = await db.sessionInstance.create({
            data: {
              centerId: user.centerId, groupId: sesInfo.groupId, date: sesInfo.date,
              startTime: sesInfo.startTime, endTime: String(p.endTime || "00:00"),
              price: g?.sessionPrice ?? 0, teacherPercent: g?.teacherPercent ?? 50,
              status: "OPEN", openedBy: user.id,
            },
          });
          sessionMap.set(String(t.entityId), { ...sesInfo, id: created.id, create: false });
        } else if (sesInfo.status === "CANCELLED") {
          await db.sessionInstance.update({ where: { id: sesInfo.id }, data: { status: "OPEN", openedBy: user.id } });
        }
        appliedIds.push(t.id); imported++;
        continue;
      }

      if (op === "SESSION_ENDED") {
        const sesInfo = sessionMap.get(String(t.entityId || ""));
        if (!sesInfo) throw new Error("الحصة مش متعرّفة");
        let sessionId = sesInfo.id;
        if (!sessionId) {
          const g = await db.group.findUnique({ where: { id: sesInfo.groupId }, select: { sessionPrice: true, teacherPercent: true } });
          const created = await db.sessionInstance.create({
            data: {
              centerId: user.centerId, groupId: sesInfo.groupId, date: sesInfo.date,
              startTime: sesInfo.startTime, endTime: "00:00",
              price: g?.sessionPrice ?? 0, teacherPercent: g?.teacherPercent ?? 50,
              status: "OPEN", openedBy: user.id,
            },
          });
          sessionId = created.id;
          sessionMap.set(String(t.entityId), { ...sesInfo, id: created.id, create: false });
        }
        // القفل بحسابات فعلية من الحضور المستورد (المرجع = الداتا الحية)
        const { sessionEconomics } = await import("@/lib/finance");
        const econ = await sessionEconomics(sessionId);
        const grp = await db.group.findUnique({ where: { id: sesInfo.groupId }, include: { subject: true, teacher: true } });
        await db.$transaction(async (tx) => {
          await tx.sessionInstance.update({
            where: { id: sessionId! },
            data: { status: "CLOSED", closedBy: user.id, closedAt: new Date(), presentCount: econ.presentCount, totalRevenue: econ.totalRevenue, teacherShare: econ.teacherShare, centerShare: econ.centerShare },
          });
          if (grp?.teacherId && econ.teacherShare > 0) {
            await tx.teacherSettlement.create({
              data: { centerId: user.centerId, teacherId: grp.teacherId, sessionId: sessionId!, type: "EARNED", amount: econ.teacherShare, date: sesInfo.date, note: `حصة ${grp.subject.name} ${sesInfo.date} (طوارئ ${t.id})`, createdBy: user.id },
            });
          }
          if (econ.totalRevenue > 0) {
            await tx.centerTransaction.createMany({
              data: [
                { centerId: user.centerId, type: "SESSION_REVENUE", amount: econ.totalRevenue, date: sesInfo.date, note: `إيراد حصة ${grp?.subject.name ?? ""} (طوارئ ${t.id})`, refType: "SESSION", refId: sessionId!, createdBy: user.id },
                { centerId: user.centerId, type: "TEACHER_SHARE", amount: -econ.teacherShare, date: sesInfo.date, note: `نصيب المدرس ${grp?.teacher?.name ?? ""} (طوارئ ${t.id})`, refType: "SESSION", refId: sessionId!, createdBy: user.id },
              ],
            });
          }
        });
        appliedIds.push(t.id); imported++;
        continue;
      }

      if (op === "SESSION_CANCELLED") {
        const sesInfo = sessionMap.get(String(t.entityId || ""));
        if (sesInfo?.id && sesInfo.status !== "CLOSED") {
          await db.sessionInstance.update({ where: { id: sesInfo.id }, data: { status: "CANCELLED", closedBy: user.id } });
        }
        appliedIds.push(t.id); imported++;
        continue;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique constraint/i.test(msg)) {
        a.duplicates.push({ txnId: t.id, reason: "اتزامنت في نفس اللحظة" });
      } else {
        conflictDetails.push({ txnId: t.id, reason: msg });
      }
    }
  }

  // ===== علامات الاستيراد + سجل نهائي + تدقيق =====
  if (appliedIds.length > 0) {
    await db.emergencyImportedTxn.createMany({
      data: appliedIds.map((id) => {
        const t = txnMap.get(id);
        return {
          id, packageId: a.license.packageId, centerId: user.centerId,
          opType: String(t?.op ?? ""), entityType: String(t?.entityType ?? ""),
          entityId: t?.entityId ? String(t.entityId) : null, importId: importRow.id,
        };
      }),
    });
  }

  await db.emergencyRecoveryImport.update({
    where: { id: importRow.id },
    data: {
      imported,
      skipped,
      details: JSON.stringify({ conflicts: a.conflicts.slice(0, 50), applyErrors: conflictDetails.slice(0, 20) }),
    },
  });

  await logAudit({
    user,
    action: AUDIT.EMERGENCY_RECOVERY_IMPORTED,
    entity: "CENTER",
    entityId: user.centerId,
    after: {
      packageId: a.license.packageId, total: a.total, imported,
      duplicates: a.duplicates.length, conflicts: a.conflicts.length, skipped,
    },
  });

  const message = imported > 0
    ? `تم استيراد ${imported} معاملة من ملف الاسترداد بنجاح.`
    : "مفيش معاملات جديدة تتزامن.";
  return {
    imported,
    duplicates: a.duplicates.length,
    conflicts: a.conflicts.length,
    skipped,
    message,
    conflictDetails,
  };
}
