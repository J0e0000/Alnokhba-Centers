import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, canRegisterStudents, generateStudentCode, generateQrToken, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { normalizeDigits, validateEgyptianPhone } from "@/lib/normalize";
import { PRICING } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type BulkRow = {
  name?: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  gradeId?: string;
  groupIds?: string[];
  code?: string;
};

type RowError = { row: number; message: string };

/** POST /api/students/bulk — إضافة دفعة طلاب مرة واحدة.
 *  قاعدة صارمة: التحقق من الدفعة كلها قبل أي إنشاء (all-or-nothing) —
 *  أي خطأ في أي صف = صفر طلاب يتسجلوا + قايمة أخطاء لكل صف.
 *  منع التكرار: داخل الدفعة (موبايل/اسم+موبايل ولي/كود) ومع الطلاب الموجودين. */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  if (!canRegisterStudents(user)) {
    throw new ApiError("مسموح للإضافة بس المدير أو موظف عنده صلاحية الإضافة.", 403);
  }

  const body = await readJson<{ students?: BulkRow[] }>(req);
  const rows = Array.isArray(body.students) ? body.students : [];
  if (rows.length === 0) throw new ApiError("مفيش صفوف في الدفعة — ضيف طلاب الأول.");
  if (rows.length > 100) throw new ApiError("الحد الأقصى 100 طالب في الدفعة الواحدة.");

  // ===== المراحل والمعايير المتاحة (بتتحقق مرة واحدة) =====
  const grades = await db.grade.findMany({ where: { centerId: user.centerId } });
  const gradeIds = new Set(grades.map((g) => g.id));

  // ===== سعة الحساب =====
  const nonArchived = await db.student.count({ where: { centerId: user.centerId, status: { not: "ARCHIVED" } } });
  if (nonArchived + rows.length > PRICING.hardLimitStudents) {
    throw new ApiError(
      `الدفعة دي بتعدّي الحد الأقصى للحساب (${PRICING.hardLimitStudents.toLocaleString("en-EG")} طالب) — المتبقي ${(PRICING.hardLimitStudents - nonArchived).toLocaleString("en-EG")} مكان بس.`,
      409,
    );
  }

  // ===== التحقق صف بصف (قبل أي كتابة) =====
  const errors: RowError[] = [];
  type ValidRow = {
    name: string; phone: string; parentName: string; parentPhone: string;
    gradeId: string; groupIds: string[]; code?: string;
  };
  const valid: ValidRow[] = [];
  const seenPhone = new Map<string, number>(); // normalized phone → row index
  const seenNameParent = new Map<string, number>(); // name|parentPhone → row index
  const seenCode = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;

    const name = normalizeDigits(String(r.name ?? "")).replace(/\s+/g, " ").trim();
    if (!name || name.length < 5) {
      errors.push({ row: rowNo, message: "الاسم كامل مطلوب (3 أسماء على الأقل زي: أحمد محمد علي)." });
      continue;
    }

    const phoneCheck = validateEgyptianPhone(String(r.phone ?? ""));
    if (!phoneCheck.ok) {
      errors.push({ row: rowNo, message: `موبايل الطالب: ${phoneCheck.error}` });
      continue;
    }

    const parentName = String(r.parentName ?? "").trim();
    if (!parentName) {
      errors.push({ row: rowNo, message: "اسم ولي الأمر مطلوب." });
      continue;
    }

    const parentPhoneCheck = validateEgyptianPhone(String(r.parentPhone ?? ""));
    if (!parentPhoneCheck.ok) {
      errors.push({ row: rowNo, message: `موبايل ولي الأمر: ${parentPhoneCheck.error}` });
      continue;
    }

    const gradeId = String(r.gradeId ?? "");
    if (!gradeId || !gradeIds.has(gradeId)) {
      errors.push({ row: rowNo, message: "المرحلة مختارة غلط أو مش موجودة." });
      continue;
    }

    // كود يدوي؟ (المدير بس — زي الإضافة الفردية)
    let code: string | undefined;
    if (r.code && normalizeDigits(String(r.code)).trim()) {
      const raw = normalizeDigits(String(r.code)).trim();
      if (!/^\d{5}$/.test(raw)) {
        errors.push({ row: rowNo, message: `الكود لازم 5 أرقام بالظبط — اللي مكتوب ${raw.length} رقم.` });
        continue;
      }
      if (user.role !== "MANAGER") {
        errors.push({ row: rowNo, message: "الكود اليدوي للمدير بس — سيبه فاضي وسيتم توليده تلقائي." });
        continue;
      }
      code = raw;
    }

    // تكرار جوّه الدفعة
    if (seenPhone.has(phoneCheck.normalized)) {
      errors.push({ row: rowNo, message: `نفس موبايل الطالب متكرر في الدفعة (صف ${seenPhone.get(phoneCheck.normalized)}).` });
      continue;
    }
    const np = `${name}|${parentPhoneCheck.normalized}`;
    if (seenNameParent.has(np)) {
      errors.push({ row: rowNo, message: `نفس الطالب (الاسم + موبايل ولي الأمر) متكرر في الدفعة (صف ${seenNameParent.get(np)}).` });
      continue;
    }
    if (code && seenCode.has(code)) {
      errors.push({ row: rowNo, message: `الكود ${code} متكرر جوّه الدفعة (صف ${seenCode.get(code)}).` });
      continue;
    }

    seenPhone.set(phoneCheck.normalized, rowNo);
    seenNameParent.set(np, rowNo);
    if (code) seenCode.set(code, rowNo);
    valid.push({ name, phone: phoneCheck.normalized, parentName, parentPhone: parentPhoneCheck.normalized, gradeId, groupIds: (r.groupIds ?? []).map(String), code });
  }

  // ===== تكرار مع الطلاب الموجودين =====
  if (valid.length > 0) {
    const phones = valid.map((v) => v.phone);
    const existingByPhone = await db.student.findMany({
      where: { centerId: user.centerId, phone: { in: phones } },
      select: { phone: true, name: true, code: true },
    });
    const phoneSet = new Set(existingByPhone.map((s) => s.phone));

    const nameParents = valid.map((v) => `${v.name}|${v.parentPhone}`);
    const existingByNameParent = await db.student.findMany({
      where: { centerId: user.centerId },
      select: { name: true, parentPhone: true, code: true },
    });
    const npSet = new Set(existingByNameParent.map((s) => `${s.name}|${s.parentPhone}`));

    const codes = valid.map((v) => v.code).filter((c): c is string => !!c);
    let codeSet = new Set<string>();
    if (codes.length) {
      const existingByCode = await db.student.findMany({
        where: { centerId: user.centerId, code: { in: codes } },
        select: { code: true },
      });
      codeSet = new Set(existingByCode.map((s) => s.code));
    }

    const stillValid: ValidRow[] = [];
    for (let i = 0; i < valid.length; i++) {
      const v = valid[i];
      const originalRow = i + 1;
      if (phoneSet.has(v.phone)) {
        errors.push({ row: originalRow, message: "في طالب موجود بنفس موبايل الطالب ده." });
        continue;
      }
      if (npSet.has(`${v.name}|${v.parentPhone}`)) {
        errors.push({ row: originalRow, message: "الطالب ده مسجل خلاص (نفس الاسم + موبايل ولي الأمر)." });
        continue;
      }
      if (v.code && codeSet.has(v.code)) {
        errors.push({ row: originalRow, message: `الكود ${v.code} مستخدم لطالب موجود.` });
        continue;
      }
      stillValid.push(v);
    }
    valid.length = 0;
    valid.push(...stillValid);
  }

  // أي خطأ = مفيش إنشاء خالص (كل الدفعة ولا ولا حاجة)
  if (errors.length > 0) {
    return ok({ created: 0, errors }, { status: 422 });
  }

  // ===== المجموعات المطلوبة (بتتحقق مرة واحدة) =====
  const allGroupIds = [...new Set(valid.flatMap((v) => v.groupIds))];
  const groups = allGroupIds.length
    ? await db.group.findMany({ where: { id: { in: allGroupIds }, centerId: user.centerId, isActive: true } })
    : [];
  const groupSet = new Set(groups.map((g) => g.id));

  // ===== الإنشاء — معاملة واحدة (كل الدفعة أو لا شيء) =====
  const created = await db.$transaction(async (tx) => {
    const out: { id: string; name: string; code: string }[] = [];
    for (const v of valid) {
      const code = v.code ?? (await generateStudentCode(user.centerId));
      const st = await tx.student.create({
        data: {
          centerId: user.centerId,
          code,
          qrToken: generateQrToken(),
          name: v.name,
          phone: v.phone,
          parentName: v.parentName,
          parentPhone: v.parentPhone,
          gradeId: v.gradeId,
          status: "ACTIVE",
        },
      });
      for (const gid of v.groupIds) {
        if (groupSet.has(gid)) {
          await tx.studentGroup.create({ data: { studentId: st.id, groupId: gid, registeredBy: user.id } });
        }
      }
      out.push({ id: st.id, name: st.name, code: st.code });
    }
    return out;
  });

  await logAudit({
    user,
    action: AUDIT.STUDENT_CREATED,
    entity: "STUDENT",
    entityId: "bulk",
    after: { bulk: true, count: created.length, names: created.map((c) => `${c.code} ${c.name}`) },
  });

  return ok({ created: created.length, students: created }, { status: 201 });
});
