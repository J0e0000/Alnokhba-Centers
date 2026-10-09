import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput, type AgentCard } from "./types";
import { normalizeDigits } from "@/lib/normalize";
import { generateStudentCode, generateQrToken } from "@/lib/auth";
import { validateEgyptianPhone } from "@/lib/normalize";
import { PRICING } from "@/lib/pricing";
import { recordUndo } from "@/lib/undo";
import { logAudit, AUDIT } from "@/lib/audit";

/* ============================================================
   TOOLS: الطلاب — student.search / student.get
   كل القراءة محصورة بسنتر المستخدم (centerId من الجلسة — مش من الـ LLM)
============================================================ */

const studentCard = (s: {
  id: string; name: string; code: string; status?: string; phone?: string | null;
  gradeName?: string | null; groups?: string[]; balancePiastres?: number | null;
}): AgentCard => ({
  type: "student",
  title: s.name,
  subtitle: `كود ${s.code}${s.gradeName ? ` · ${s.gradeName}` : ""}${s.groups?.length ? ` · ${s.groups.join("، ")}` : ""}`,
  actions: [{ label: "فتح ملف الطالب", action: "navigate", view: "students", studentId: s.id }],
  rows: s.balancePiastres != null
    ? [{ label: "الرصيد", value: `${Math.round(Math.abs(s.balancePiastres) / 100)} ${s.balancePiastres < 0 ? "ج عليه" : "ج له"}`, tone: s.balancePiastres < 0 ? "bad" : "good" }]
    : undefined,
});

register({
  name: "student.search",
  group: "students",
  description: "دور على طالب بالاسم أو الكود أو رقم الموبايل — بيرجع قايمة مطابقة",
  usageHint: "لما المستخدم يسأل عن طالب بالاسم أو يقصد طالب معين («هاتلي أحمد»)",
  input: z.object({
    q: z.string().min(2).describe("الاسم أو جزء منه أو الكود أو الموبايل"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  risk: "LOW",
  requiredPermission: "SEARCH_STUDENTS",
  permissionLabel: "البحث عن الطلاب",
  async handler(args, ctx): Promise<ToolOutput> {
    const q = normalizeDigits(args.q.trim());
    const limit = args.limit ?? 8;
    const codeOnly = /^\d{5}$/.test(q);
    const students = await db.student.findMany({
      where: {
        centerId: ctx.centerId,
        OR: [
          { name: { contains: q } },
          { code: codeOnly ? q : { contains: q } },
          { phone: { contains: q } },
          { parentPhone: { contains: q } },
        ],
      },
      select: {
        id: true, name: true, code: true, status: true, phone: true,
        grade: { select: { name: true } },
        registrations: { where: { status: "ACTIVE" }, select: { group: { select: { name: true, subject: { select: { name: true } } } } } },
      },
      orderBy: { name: "asc" },
      take: limit,
    });
    if (!students.length) {
      return { summary: `مفيش طالب مطابق لـ «${args.q}» في سنترك.`, data: { matches: 0 } };
    }
    const cards: AgentCard[] = students.map((s) => studentCard({
      id: s.id, name: s.name, code: s.code, status: s.status, phone: s.phone,
      gradeName: s.grade?.name ?? null,
      groups: s.registrations.map((g) => `${g.group.subject.name} — ${g.group.name}`),
    }));
    return {
      summary: `لقيت ${students.length} ${students.length === 1 ? "طالب" : "طلبة"} مطابقين لـ «${args.q}».`,
      data: { matches: students.length, q: args.q, students: students.map((s) => ({ id: s.id, name: s.name, code: s.code, status: s.status, groups: s.registrations.map((g) => g.group.name) })) },
      cards,
    };
  },
});

register({
  name: "student.get",
  group: "students",
  description: "ملف طالب كامل: البيانات + مجموعاته + رصيده + ملخص حضوره",
  usageHint: "لما يكون عندك id أو كود الطالب وعايز تفاصيله",
  input: z.object({
    studentId: z.string().optional(),
    code: z.string().optional(),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENTS",
  permissionLabel: "عرض الطلاب",
  async handler(args, ctx): Promise<ToolOutput> {
    const student = await db.student.findFirst({
      where: {
        centerId: ctx.centerId,
        ...(args.studentId ? { id: args.studentId } : {}),
        ...(args.code ? { code: normalizeDigits(args.code) } : {}),
      },
      select: {
        id: true, name: true, code: true, status: true, phone: true, parentName: true, parentPhone: true, school: true,
        grade: { select: { name: true } },
        registrations: { where: { status: "ACTIVE" }, select: { group: { select: { name: true, subject: { select: { name: true } } } } } },
      },
    });
    if (!student) throw new ToolError("NOT_FOUND", "الطالب ده مش موجود في السنتر.");
    // الرصيد + الحضور (الرصيد بس لو معاه صلاحية الحالة المالية)
    const hasFin = ctx.user.permissions.includes("VIEW_STUDENT_FINANCIAL_STATUS") || ctx.user.role === "MANAGER";
    const bal = await db.studentTransaction.aggregate({ where: { studentId: student.id }, _sum: { amount: true } });
    const att = await db.attendance.groupBy({
      by: ["status"],
      where: { studentId: student.id },
      _count: true,
    });
    const attMap = Object.fromEntries(att.map((a) => [a.status, a._count]));
    const totalAtt = att.reduce((s, a) => s + a._count, 0);
    const presentRate = totalAtt ? Math.round(((attMap.PRESENT ?? 0) + (attMap.LATE ?? 0)) / totalAtt * 100) : null;
    const balance = hasFin ? (bal._sum.amount ?? 0) : null;
    const card = studentCard({
      id: student.id, name: student.name, code: student.code, status: student.status,
      gradeName: student.grade?.name ?? null,
      groups: student.registrations.map((g) => `${g.group.subject.name} — ${g.group.name}`),
      balancePiastres: balance,
    });
    card.rows = [
      ...(card.rows ?? []),
      { label: "الحضور", value: presentRate != null ? `${presentRate}% (${totalAtt} حصة)` : "مفيش حضور", tone: presentRate != null && presentRate < 70 ? "warn" : "info" },
      { label: "ولي الأمر", value: student.parentName ? `${student.parentName}${student.parentPhone ? ` — ${student.parentPhone}` : ""}` : "—" },
    ];
    return {
      summary: `ملف ${student.name} (كود ${student.code}) — ${student.registrations.length} مجموعة نشطة${presentRate != null ? `، حضور ${presentRate}%` : ""}.`,
      data: {
        student: { id: student.id, name: student.name, code: student.code, status: student.status, grade: student.grade?.name },
        groups: student.registrations.map((g) => g.group.name),
        presentRate, totalAtt,
        ...(hasFin ? { balancePiastres: balance } : {}),
      },
      cards: [card],
    };
  },
});

/* ============================================================
   TOOLS: كتابة الطلاب — student.create / student.update
   نفس قواعد POST/PATCH /api/students بالظبط (حد الحساب،
   التليفونات المصرية، الكود أوتوماتيك) — القرار للوكيل والتنفيذ
   بنفس الفحوص. الخطوة دي خلت الوكيل «كامل» في أدوات الإدارة.
============================================================ */

register({
  name: "student.create",
  group: "students",
  description: "سجّل طالب جديد في السنتر: اسم كامل + موبايل + ولي أمر + المرحلة — ولو ذكرت مجموعة يسجل فيها فورًا. الكود بيتولد أوتوماتيك",
  usageHint: "«ضيف طالب اسمه أحمد محمد علي موبايل 01012345678 ولي أمره أحمد والتليفون 01098765432 في المرحلة الأول الثانوي» — لو المجموعة مش متحدد اسأل أو سيبه من غير",
  input: z.object({
    name: z.string().min(5, "الاسم لازم يكون كامل (3 أسماء على الأقل)").max(80),
    phone: z.string().min(8).max(15).describe("موبايل الطالب"),
    parentName: z.string().min(2).max(80),
    parentPhone: z.string().min(8).max(15).describe("موبايل ولي الأمر"),
    grade: z.string().min(1).max(60).describe("اسم المرحلة زي «الأول الثانوي»"),
    group: z.string().max(80).optional().describe("مجموعة يسجل فيها فورًا (بالاسم/المادة) — اختياري"),
    school: z.string().max(80).optional(),
    notes: z.string().max(500).optional(),
  }),
  risk: "HIGH",
  requiredPermission: "ADD_STUDENT",
  permissionLabel: "إضافة طلاب جدد",
  async handler(args, ctx): Promise<ToolOutput> {
    // حد الحساب الصارم — نفس POST /api/students
    const nonArchived = await db.student.count({ where: { centerId: ctx.centerId, status: { not: "ARCHIVED" } } });
    if (nonArchived >= PRICING.hardLimitStudents) {
      throw new ToolError("STATE", `وصلت الحد الأقصى للحساب (${PRICING.hardLimitStudents.toLocaleString("en-EG")} طالب) — أرشفة طلاب قبل ما تسجّل من جديد.`);
    }
    const name = normalizeDigits(args.name).replace(/\s+/g, " ").trim();
    if (name.length < 5) throw new ToolError("VALIDATION", "اكتب اسم الطالب كامل (3 أسماء على الأقل زي: أحمد محمد علي).");
    const phoneCheck = validateEgyptianPhone(args.phone);
    if (!phoneCheck.ok) throw new ToolError("VALIDATION", phoneCheck.error);
    const parentPhoneCheck = validateEgyptianPhone(args.parentPhone, true);
    if (!parentPhoneCheck.ok) throw new ToolError("VALIDATION", parentPhoneCheck.error);
    const grade = await db.grade.findFirst({ where: { centerId: ctx.centerId, OR: [{ name: args.grade }, { name: { contains: args.grade } }] }, select: { id: true, name: true } });
    if (!grade) {
      const grades = await db.grade.findMany({ where: { centerId: ctx.centerId }, select: { name: true }, take: 8 });
      throw new ToolError("NOT_FOUND", `مفيش مرحلة اسمها «${args.grade}» — الموجود: ${grades.map((g) => g.name).join(" / ")}`);
    }
    let group: { id: string; name: string; subject: string } | null = null;
    if (args.group) {
      const { resolveGroupFlexible } = await import("./groups");
      const g = await resolveGroupFlexible(args.group, ctx.centerId);
      const active = await db.group.findFirst({ where: { id: g.id, centerId: ctx.centerId, isActive: true }, select: { id: true } });
      if (!active) throw new ToolError("STATE", `مجموعة ${g.subject} — ${g.name} موقوفة — شغّلها الأول.`);
      group = g;
    }

    const code = await generateStudentCode(ctx.centerId);
    const student = await db.$transaction(async (tx) => {
      const st = await tx.student.create({
        data: {
          centerId: ctx.centerId, code, qrToken: generateQrToken(),
          name, phone: phoneCheck.normalized, parentName: args.parentName.trim(), parentPhone: parentPhoneCheck.normalized,
          gradeId: grade.id, school: args.school?.trim() || null, status: "ACTIVE", notes: args.notes?.trim() || null,
        },
      });
      if (group) {
        await tx.studentGroup.create({ data: { studentId: st.id, groupId: group.id, registeredBy: ctx.user.id } });
      }
      return st;
    });
    await logAudit({
      user: ctx.user, action: AUDIT.STUDENT_CREATED, entity: "STUDENT", entityId: student.id,
      after: { code: student.code, name: student.name, groups: group ? [group.name] : [], via: "agent" },
    });
    await recordUndo({
      user: ctx.user, entity: "STUDENT", entityId: student.id, action: "CREATE",
      label: `إضافة الطالب ${student.name} (كود ${student.code})`,
      forward: { id: student.id }, inverse: { id: student.id, status: "ACTIVE" },
    });
    return {
      summary: `سجلت الطالب ${name} — كوده ${code}${group ? ` وسجلته في ${group.subject} — ${group.name}` : ""}.`,
      confirmSummary: `هسجل طالب جديد: ${name} (${grade.name}) بموبايل ${phoneCheck.normalized}${group ? ` ويسجل في ${group.subject} — ${group.name}` : ""}.`,
      data: { studentId: student.id, code, enrolledGroup: group?.name ?? null },
      cards: [{
        type: "student", title: name, subtitle: `كود ${code} · ${grade.name}${group ? ` · ${group.subject} — ${group.name}` : ""}`,
        actions: [{ label: "فتح ملف الطالب", action: "navigate" as const, view: "students", studentId: student.id }],
      }],
    };
  },
  async preview(args, ctx) {
    const name = normalizeDigits(args.name).replace(/\s+/g, " ").trim();
    const grade = await db.grade.findFirst({ where: { centerId: ctx.centerId, OR: [{ name: args.grade }, { name: { contains: args.grade } }] }, select: { name: true } });
    let groupLabel: string | null = null;
    if (args.group) {
      const { resolveGroupFlexible } = await import("./groups");
      const g = await resolveGroupFlexible(args.group, ctx.centerId);
      groupLabel = `${g.subject} — ${g.name}`;
    }
    return {
      summary: `هسجل طالب جديد: ${name}${grade ? ` (${grade.name})` : ""}${groupLabel ? ` ويسجل في ${groupLabel}` : ""}.`,
      details: {
        الاسم: name, الموبايل: normalizeDigits(args.phone), "ولي الأمر": `${args.parentName} — ${normalizeDigits(args.parentPhone)}`,
        المرحلة: grade?.name ?? "مش موجودة!", ...(groupLabel ? { المجموعة: groupLabel } : {}),
        ...(args.school ? { المدرسة: args.school } : {}),
        الكود: "بيتولد أوتوماتيك",
      },
    };
  },
  async verify(args, output, ctx) {
    const sid = (output.data?.studentId as string) ?? null;
    if (!sid) return "مفيش معرف طالب في النتيجة.";
    const st = await db.student.findFirst({ where: { id: sid, centerId: ctx.centerId }, select: { id: true, name: true, code: true } });
    if (!st) return "الطالب الجديد مظهرش في الداتابيز.";
    const expectedCode = (output.data?.code as string) ?? "";
    if (expectedCode && st.code !== expectedCode) return "كود الطالب مش مطابق.";
    if (args.group) {
      const reg = await db.studentGroup.findFirst({ where: { studentId: sid, status: "ACTIVE" }, select: { id: true } });
      if (!reg) return "الطالب اتعمل بس التسجيل في المجموعة محفوظش.";
    }
    return null;
  },
});

register({
  name: "student.update",
  group: "students",
  description: "عدّل بيانات طالب: الموبايل أو موبايل ولي الأمر أو المدرسة أو الملاحظات — أو وقف/شغّل الطالب (إيقاف محتاج صلاحية أرشفة)",
  usageHint: "«غير رقم أحمد لـ 01011122233» / «وقف الطالب 99002» — حدد الطالب بالاسم أو الكود والقيمة الجديدة",
  input: z.object({
    student: z.string().min(1).max(80).describe("الطالب بالاسم أو الكود"),
    phone: z.string().min(8).max(15).optional(),
    parentPhone: z.string().min(8).max(15).optional(),
    school: z.string().max(80).optional(),
    notes: z.string().max(500).optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("ACTIVE = شغل · PAUSED = وقف مؤقت"),
  }),
  risk: "MEDIUM",
  requiredPermission: "EDIT_STUDENT",
  permissionLabel: "تعديل بيانات طالب",
  async handler(args, ctx): Promise<ToolOutput> {
    const student = await resolveStudentFlexible(args.student, ctx.centerId);
    const data: Record<string, unknown> = {};
    if (args.phone !== undefined) {
      const c = validateEgyptianPhone(args.phone);
      if (!c.ok) throw new ToolError("VALIDATION", c.error);
      data.phone = c.normalized;
    }
    if (args.parentPhone !== undefined) {
      const c = validateEgyptianPhone(args.parentPhone, true);
      if (!c.ok) throw new ToolError("VALIDATION", c.error);
      data.parentPhone = c.normalized;
    }
    if (args.school !== undefined) data.school = args.school.trim() || null;
    if (args.notes !== undefined) data.notes = args.notes.trim() || null;
    if (args.status !== undefined) {
      const canArchive = ctx.user.role === "MANAGER" || ctx.user.permissions.includes("ARCHIVE_STUDENT");
      if (!canArchive) throw new ToolError("PERMISSION", "إيقاف/تشغيل الطالب محتاج صلاحية «أرشفة طالب» — كلم مدير السنتر.");
      data.status = args.status;
    }
    if (!Object.keys(data).length) throw new ToolError("VALIDATION", "حدد حاجة تتغير على الأقل (موبايل/مدرسة/ملاحظات/إيقاف).");
    const before = await db.student.findUnique({ where: { id: student.id }, select: { phone: true, parentPhone: true, school: true, notes: true, status: true } });
    await db.student.update({ where: { id: student.id }, data });
    await logAudit({
      user: ctx.user, action: AUDIT.STUDENT_UPDATED, entity: "STUDENT", entityId: student.id,
      before: before ?? undefined, after: data, reason: "تعديل طالب عن طريق زكي",
    });
    const changes: string[] = [];
    if (data.phone) changes.push(`موبايله بقى ${data.phone}`);
    if (data.parentPhone) changes.push(`موبايل ولي الأمر بقى ${data.parentPhone}`);
    if (data.school !== undefined) changes.push(`المدرسة بقى ${data.school || "—"}`);
    if (data.notes !== undefined) changes.push("الملاحظات اتحدثت");
    if (data.status) changes.push(data.status === "PAUSED" ? "الطالب اتوقف" : "الطالب رجع نشط");
    return {
      summary: `عدّلت بيانات ${student.name}: ${changes.join(" · ")}.`,
      confirmSummary: `هعدّل بيانات ${student.name} (كود ${student.code}): ${changes.join(" · ")}.`,
      data: { studentId: student.id, changes: data },
    };
  },
  async preview(args, ctx) {
    const student = await resolveStudentFlexible(args.student, ctx.centerId);
    const full = await db.student.findUnique({
      where: { id: student.id },
      select: { phone: true, parentPhone: true, school: true, status: true, name: true, code: true },
    });
    if (!full) throw new ToolError("NOT_FOUND", "الطالب مش موجود.");
    return {
      summary: `هعدّل بيانات ${full.name} (كود ${full.code}).`,
      details: {
        "الحالة الحالية": `موبايل ${full.phone ?? "—"} · ولي أمر ${full.parentPhone ?? "—"} · ${full.status}`,
        ...(args.phone ? { "الموبايل الجديد": normalizeDigits(args.phone) } : {}),
        ...(args.parentPhone ? { "موبايل ولي الأمر الجديد": normalizeDigits(args.parentPhone) } : {}),
        ...(args.school !== undefined ? { "المدرسة الجديدة": args.school } : {}),
        ...(args.status ? { "الحالة الجديدة": args.status === "PAUSED" ? "موقوف مؤقتًا" : "نشط" } : {}),
      },
    };
  },
  async verify(args, _output, ctx) {
    const student = await resolveStudentFlexible(args.student, ctx.centerId).catch(() => null);
    if (!student) return "الطالب مظهرش بعد التعديل.";
    const after = await db.student.findUnique({ where: { id: student.id }, select: { phone: true, parentPhone: true, status: true, school: true } });
    if (!after) return "الطالب اختفى من الداتابيز.";
    if (args.phone && after.phone !== normalizeDigits(args.phone)) return "الموبايل الجديد محفوظش صح.";
    if (args.status && after.status !== args.status) return "حالة الطالب محفوظتش صح.";
    return null;
  },
});

/** مطابقة طالب مرنة: كود 5 أرقام exact، وإلا بحث بالاسم — أكتر من واحد = خطأ بالخيارات */
export async function resolveStudentFlexible(q: string, centerId: string): Promise<{ id: string; name: string; code: string }> {
  const nq = normalizeDigits(q.trim());
  if (/^\d{5}$/.test(nq)) {
    const byCode = await db.student.findUnique({ where: { centerId_code: { centerId, code: nq } }, select: { id: true, name: true, code: true } });
    if (byCode) return byCode;
  }
  const token = nq.replace(/\s+/g, " ").split(" ").filter(Boolean)[0] ?? nq;
  const matches = await db.student.findMany({
    where: { centerId, OR: [{ name: { contains: token } }, { name: { contains: q.trim() } }] },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" }, take: 6,
  });
  if (!matches.length) throw new ToolError("NOT_FOUND", `مفيش طالب مطابق لـ «${q}» في سنترك.`);
  if (matches.length > 1) {
    // لو الاسم الكامل مطابق لواحد بالظبط — خده
    const exact = matches.find((m) => m.name.replace(/\s+/g, " ").trim() === q.replace(/\s+/g, " ").trim());
    if (exact) return exact;
    throw new ToolError("VALIDATION", `في أكتر من طالب اسمه زي «${q}» — حدد بالكود: ${matches.slice(0, 4).map((m) => `${m.name} (${m.code})`).join(" / ")}`);
  }
  return matches[0];
}
