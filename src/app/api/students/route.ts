import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { assertStudentQuotaTx } from "@/lib/entitlements";
import { requireCenterUser, canRegisterStudents, generateStudentCode, generateQrToken, ApiError } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { logAudit, AUDIT } from "@/lib/audit";
import { cleanRaw, normalizeDigits, validateEgyptianPhone, toPiastres } from "@/lib/normalize";
import { recordUndo } from "@/lib/undo";
import { manyBalances } from "@/lib/finance";
import { PRICING } from "@/lib/pricing";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** GET /api/students?q=&status=&gradeId=&groupId=&page= — search & list (tenant-scoped)
 *  Server-side pagination — الحد الأقصى 50/صفحة وترتيب ثابت (deterministic)
 *  فلاتر المرحلة والمجموعة (فكرة الريبو المرجعي: فلتر مرحلة مقسّم + فلتر مجموعة)
 *  تدقيق المرحلة 2 #6: بيانات الطلاب (تليفونات/أرصدة) PII — القراءة محتاجة صلاحية صريحة */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  if (!hasPermission(user, "VIEW_STUDENTS")) {
    throw new ApiError("عرض الطلاب محتاج صلاحية «عرض الطلاب» — كلّم المدير يوزّها لك.", 403);
  }
  const url = new URL(req.url);
  const q = cleanRaw(url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status") ?? "";
  const groupId = url.searchParams.get("groupId") ?? "";
  const gradeId = url.searchParams.get("gradeId") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "24", 10) || 24));

  const where: Prisma.StudentWhereInput = { centerId: user.centerId };
  if (status) where.status = status;
  if (q) {
    // Arabic-Indic normalized: match code/phone by digits, name by contains
    where.OR = [
      { code: { contains: q } },
      { name: { contains: url.searchParams.get("q") ?? "" } },
      { phone: { contains: q } },
      { parentPhone: { contains: q } },
    ];
  }
  if (groupId) where.registrations = { some: { groupId, status: "ACTIVE" } };
  if (gradeId) where.gradeId = gradeId;

  const [total, students] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      // ترتيب ثابت (tiebreaker بالـ id) عشان الصفحات متتقلبش مع تواريخ متطابقة
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        grade: { select: { name: true } },
        registrations: {
          where: { status: "ACTIVE" },
          include: { group: { include: { subject: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  const balances = await manyBalances(user.centerId, students.map((s) => s.id));

  return ok({
    total,
    page,
    pageSize,
    students: students.map((s) => {
      const balance = balances.get(s.id) ?? 0;
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        phone: s.phone,
        parentPhone: s.parentPhone,
        grade: s.grade?.name ?? null,
        status: s.status,
        subjects: s.registrations.map((r) => r.group.subject.name),
        balance,
        createdAt: s.createdAt,
      };
    }),
  });
});

type CreateBody = {
  name?: string; phone?: string; parentName?: string; parentPhone?: string;
  gradeId?: string; school?: string; groupIds?: string[]; status?: string; notes?: string; code?: string;
};

/** POST /api/students — register new student with smart validation */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "students", user);
  if (!canRegisterStudents(user)) {
    throw new ApiError("مسموح للإضافة بس المدير أو موظف عنده صلاحية الإضافة.", 403);
  }
  const body = await readJson<CreateBody>(req);

  // حد الحساب الصارم: 10,000 طالب (تسعير النخبة)
  const nonArchived = await db.student.count({ where: { centerId: user.centerId, status: { not: "ARCHIVED" } } });
  if (nonArchived >= PRICING.hardLimitStudents) {
    throw new ApiError(
      `وصلت الحد الأقصى للحساب (${PRICING.hardLimitStudents.toLocaleString("en-EG")} طالب) — أرشفة طلاب قبل ما تسجّل من جديد.`,
      409,
    );
  }

  const name = normalizeDigits(String(body.name ?? "")).replace(/\s+/g, " ").trim();
  if (!name || name.length < 5) {
    throw new ApiError("اكتب اسم الطالب كامل (3 أسماء على الأقل زي: أحمد محمد علي).");
  }

  const phoneCheck = validateEgyptianPhone(String(body.phone ?? ""));
  if (!phoneCheck.ok) throw new ApiError(phoneCheck.error);

  const parentName = String(body.parentName ?? "").trim();
  if (!parentName) throw new ApiError("اسم ولي الأمر مطلوب.");

  const parentPhoneCheck = validateEgyptianPhone(String(body.parentPhone ?? ""), true);
  if (!parentPhoneCheck.ok) throw new ApiError(parentPhoneCheck.error);

  const gradeId = String(body.gradeId ?? "");
  if (!gradeId) throw new ApiError("اختار مرحلة الطالب.");
  const grade = await db.grade.findFirst({ where: { id: gradeId, centerId: user.centerId } });
  if (!grade) throw new ApiError("المرحلة اللي اخترتها مش موجودة في السنتر ده.");

  const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String) : [];
  const groups = groupIds.length
    ? await db.group.findMany({ where: { id: { in: groupIds }, centerId: user.centerId, isActive: true } })
    : [];
  if (groupIds.length !== groups.length) throw new ApiError("في مجموعة من اللي اخترتها مش موجودة.");

  const status = ["ACTIVE", "PAUSED", "ARCHIVED"].includes(body.status ?? "") ? body.status! : "ACTIVE";

  // 5-digit code: auto-generate or validate manual override
  let code: string;
  if (body.code && cleanRaw(body.code)) {
    const raw = cleanRaw(String(body.code));
    if (!/^\d{5}$/.test(raw)) {
      throw new ApiError(`كود الطالب لازم يكون 5 أرقام بالظبط — اللي كتبته ${raw.length} رقم.`);
    }
    if (user.role !== "MANAGER") {
      throw new ApiError("تغيير الكود اليدوي للمدير بس — الكود بيتولد أوتوماتيك.");
    }
    const exists = await db.student.findUnique({ where: { centerId_code: { centerId: user.centerId, code: raw } } });
    if (exists) throw new ApiError(`الكود ${raw} مستخدم لطالب تاني في نفس السنتر — اختار كود تاني.`);
    code = raw;
  } else {
    code = await generateStudentCode(user.centerId);
  }

  const student = await db.$transaction(async (tx) => {
    // حصة الطلاب من الخطة (Master Prompt §5) — جوه الـ transaction لمنع السباق
    await assertStudentQuotaTx(tx, user.centerId);
    const st = await tx.student.create({
      data: {
        centerId: user.centerId,
        code,
        qrToken: generateQrToken(),
        name,
        phone: phoneCheck.normalized,
        parentName,
        parentPhone: parentPhoneCheck.normalized,
        gradeId,
        school: body.school?.trim() || null,
        status,
        notes: body.notes?.trim() || null,
      },
    });
    for (const g of groups) {
      await tx.studentGroup.create({
        data: { studentId: st.id, groupId: g.id, registeredBy: user.id },
      });
    }
    return st;
  });

  // ===== Smart detection: احتمال تكرار (نفس رقم الطالب / نفس رقم ولي الأمر) =====
  // مش مانع التسجيل — التوأم والإخوة بيشاركوا رقم ولي أمر فعلاً — بس بننبّه فورًا:
  // تحذير في رد الـ API للموظف + إشعار لحظي لكل مدراء السنتر (refId للطالب الجديد).
  const dupWarnings: string[] = [];
  const dupMatches = await db.student.findMany({
    where: {
      centerId: user.centerId,
      status: "ACTIVE",
      id: { not: student.id },
      OR: [
        ...(phoneCheck.normalized ? [{ phone: phoneCheck.normalized }] : []),
        { parentPhone: parentPhoneCheck.normalized },
      ],
    },
    select: { id: true, name: true, code: true, phone: true, parentPhone: true },
    take: 6,
  });
  for (const d of dupMatches) {
    if (phoneCheck.normalized && d.phone === phoneCheck.normalized) {
      dupWarnings.push(`نفس رقم موبايل الطالب: ${d.name} (كود ${d.code})`);
    } else if (d.parentPhone === parentPhoneCheck.normalized) {
      dupWarnings.push(`نفس رقم ولي الأمر: ${d.name} (كود ${d.code})`);
    }
  }
  if (dupWarnings.length > 0) {
    const managers = await db.user.findMany({
      where: { centerId: user.centerId, role: "MANAGER" },
      select: { id: true },
    });
    if (managers.length > 0) {
      await db.staffNotification.createMany({
        data: managers.map((m) => ({
          centerId: user.centerId,
          userId: m.id,
          type: "SYSTEM",
          title: "احتمال تكرار في تسجيل طالب",
          body: `الطالب الجديد «${student.name}» (كود ${student.code}) — ${dupWarnings.join(" · ")}. راجع الملفين لو كان تكرار بالغلط.`,
          link: "students",
          refId: `dup-student-${student.id}`,
        })),
      });
    }
  }

  await logAudit({
    user,
    action: AUDIT.STUDENT_CREATED,
    entity: "STUDENT",
    entityId: student.id,
    after: { code: student.code, name: student.name, groups: groups.map((g) => g.name) },
  });
  // قابل للتراجع (spec §13) — التراجع بيرجّع الطالب للأرشفة (مش مسح)
  await recordUndo({
    user, entity: "STUDENT", entityId: student.id, action: "CREATE",
    label: `إضافة الطالب ${student.name} (كود ${student.code})`,
    forward: { id: student.id },
    inverse: { id: student.id, status: "ACTIVE" },
  });

  return ok({ student: { id: student.id, code: student.code, name: student.name, qrToken: student.qrToken }, warnings: dupWarnings }, { status: 201 });
});

/** PUT /api/students — quick helper: price override for a registration (manager) */
export const PUT = handler(async (req: Request) => {
  const user = await requireCenterUser();
  if (user.role !== "MANAGER") throw new ApiError("تسعير الطالب ده للمدير بس.", 403);
  const body = await readJson<{ studentId?: string; groupId?: string; priceOverride?: number | null }>(req);
  const studentId = String(body.studentId ?? "");
  const groupId = String(body.groupId ?? "");
  const reg = await db.studentGroup.findUnique({
    where: { studentId_groupId: { studentId, groupId } },
    include: { group: true, student: true },
  });
  if (!reg || reg.student.centerId !== user.centerId) throw new ApiError("التسجيل ده مش موجود.", 404);

  let priceOverride: number | null = null;
  if (body.priceOverride !== null && body.priceOverride !== undefined && (body.priceOverride as unknown) !== "") {
    priceOverride = toPiastres(Number(body.priceOverride));
    if (priceOverride <= 0) throw new ApiError("السعر لازم يكون رقم أكبر من صفر.");
  }

  await db.studentGroup.update({ where: { id: reg.id }, data: { priceOverride } });
  await logAudit({
    user,
    action: AUDIT.PRICE_CHANGED,
    entity: "STUDENT_GROUP",
    entityId: reg.id,
    before: { priceOverride: reg.priceOverride },
    after: { priceOverride },
    reason: `تسعير خاص للطالب ${reg.student.name} في ${reg.group.name}`,
  });
  return ok({ ok: true });
});
