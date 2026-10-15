import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, canRegisterStudents, generateStudentCode, generateQrToken, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { normalizeDigits, validateOptionalPhone } from "@/lib/normalize";
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

/** POST /api/students/bulk — إضافة دفعة طلاب مرة واحدة (فلسفة «السريعة» — قرار مختبر UX).
 *  قواعد السرعة:
 *  - الاسم هو العمود الأساسي؛ رقم واحد موبايل كفاية (طالب أو ولي أمر) والاتنين يحتملوا الفاضي
 *    مع الاحتياطي: مفيش رقم طالب؟ نستخدم رقم ولي أمر — والعكس.
 *  - اسم ولي الأمر بيتستنتج أوتوماتيك من اسم الطالب لو اتنساب فاضي (نفس استنتاج الإضافة الفردية).
 *  - المرحلة اختيارية (بتتحدد مرة واحدة في الواجهة للدفعة كلها) — لو اتبعتت بتتحقق.
 *  قواعد الأمان (زي ما هي):
 *  - التحقق من الدفعة كلها قبل أي إنشاء (all-or-nothing) — أي خطأ في أي صف =
 *    صفر طلاب يتسجلوا + قايمة أخطاء لكل صف (row = رقم الصف المتبعت 1-based).
 *  - منع التكرار: داخل الدفعة (موبايل/اسم+موبايل ولي/كود) ومع الطلاب الموجودين.
 *  - الكود اليدوي للمدير بس و5 أرقام بالظبط. */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "students", user);
  if (!canRegisterStudents(user)) {
    throw new ApiError("مسموح للإضافة بس المدير أو موظف عنده صلاحية الإضافة.", 403);
  }

  const body = await readJson<{ students?: BulkRow[] }>(req);
  const rows = Array.isArray(body.students) ? body.students : [];
  if (rows.length === 0) throw new ApiError("مفيش صفوف في الدفعة — ضيف طلاب الأول.");
  if (rows.length > 100) throw new ApiError("الحد الأقصى 100 طالب في الدفعة الواحدة.");

  // ===== المراحل المتاحة (بتتحقق مرة واحدة) =====
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
    gradeId: string | null; groupIds: string[]; code?: string;
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

    // الأرقام كلها اختيارية بس لازم رقم واحد على الأقل — والاحتياطي بينقذ الصف
    const phoneCheck = validateOptionalPhone(String(r.phone ?? ""), "موبايل الطالب");
    if (!phoneCheck.ok) {
      errors.push({ row: rowNo, message: `موبايل الطالب: ${phoneCheck.error}` });
      continue;
    }
    const parentPhoneCheck = validateOptionalPhone(String(r.parentPhone ?? ""), "موبايل ولي الأمر");
    if (!parentPhoneCheck.ok) {
      errors.push({ row: rowNo, message: `موبايل ولي الأمر: ${parentPhoneCheck.error}` });
      continue;
    }
    let phone = phoneCheck.normalized;
    let parentPhone = parentPhoneCheck.normalized;
    if (!phone && !parentPhone) {
      errors.push({ row: rowNo, message: "اكتب رقم موبايل واحد على الأقل (طالب أو ولي أمر) — من غيره مفيش واتساب ولا دخول للبوابة." });
      continue;
    }
    if (!phone) phone = parentPhone;
    if (!parentPhone) parentPhone = phone;

    // اسم ولي الأمر: استنتاج تلقائي من اسم الطالب لو فاضي (الكلمة التانية = اسم الأب)
    let parentName = String(r.parentName ?? "").replace(/\s+/g, " ").trim();
    if (!parentName) {
      const parts = name.split(" ").filter(Boolean);
      parentName = parts.length >= 2 ? parts[1] : parts[0] ?? "";
    }

    // المرحلة اختيارية — لو اتبعتت لازم تكون موجودة
    let gradeId: string | null = null;
    const rawGrade = String(r.gradeId ?? "").trim();
    if (rawGrade) {
      if (!gradeIds.has(rawGrade)) {
        errors.push({ row: rowNo, message: "المرحلة مختارة غلط أو مش موجودة." });
        continue;
      }
      gradeId = rawGrade;
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

    // تكرار جوّه الدفعة (بعد الاحتياطيات — عشان القيم النهائية هي اللي بتتقارن)
    if (seenPhone.has(phone)) {
      errors.push({ row: rowNo, message: `نفس موبايل الطالب متكرر في الدفعة (صف ${seenPhone.get(phone)}).` });
      continue;
    }
    const np = `${name}|${parentPhone}`;
    if (seenNameParent.has(np)) {
      errors.push({ row: rowNo, message: `نفس الطالب (الاسم + موبايل ولي الأمر) متكرر في الدفعة (صف ${seenNameParent.get(np)}).` });
      continue;
    }
    if (code && seenCode.has(code)) {
      errors.push({ row: rowNo, message: `الكود ${code} متكرر جوّه الدفعة (صف ${seenCode.get(code)}).` });
      continue;
    }

    seenPhone.set(phone, rowNo);
    seenNameParent.set(np, rowNo);
    if (code) seenCode.set(code, rowNo);
    valid.push({ name, phone, parentName, parentPhone, gradeId, groupIds: (r.groupIds ?? []).map(String), code });
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
    const top = errors.slice(0, 3).map((e) => `صف ${e.row}: ${e.message}`).join(" · ");
    return ok(
      { created: 0, errors, error: `الدفععة فيها ${errors.length} صف غلط — مفيش حاجة اتسجلت. ${top}${errors.length > 3 ? ` … و${errors.length - 3} كمان` : ""}` },
      { status: 422 },
    );
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
      // ⚠️ الكود بيتولد عبر tx — generateStudentCode على db العام جوه المعاملة
      // بيعمل deadlock على pool باتصال واحد (عطل إنتاج حقيقي 2026-10-15)
      const code = v.code ?? (await generateStudentCode(user.centerId, tx));
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
