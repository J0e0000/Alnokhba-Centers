import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";
import { toPiastres } from "@/lib/normalize";
import { logAudit, AUDIT } from "@/lib/audit";

/* ============================================================
   TOOLS: المجموعات — group.list / group.enroll_student /
   group.create / group.update
   التسجيل (enroll) أداة كتابة MEDIUM: كل فحوص ما قبل التنفيذ
   (spec §32) + verify من الداتابيز (spec §34)
============================================================ */

/** تطبيع عربي للمطابقة — نفس روح fallback.ts (همزات/تاء مربوطة/تشكيل) */
function normAr(t: string): string {
  return t
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * مطابقة مرنة لمجموعة من كلام حر («رياضيات B» / «مجموعة الفيزياء — A»).
 * بترجع أفضل مطابقة، ولو فيه تعادل بترمي ToolError بالخيارات.
 */
export async function resolveGroupFlexible(q: string, centerId: string): Promise<{ id: string; name: string; subject: string; grade: string | null }> {
  const groups = await db.group.findMany({
    where: { centerId },
    select: { id: true, name: true, subject: { select: { name: true } }, grade: { select: { name: true } }, isActive: true },
    take: 200,
  });
  if (!groups.length) throw new ToolError("NOT_FOUND", "مفيش مجموعات في سنترك أصلاً.");
  const nq = normAr(q);
  const tokens = nq.split(" ").filter((w) => w.length > 1 && !["مجموعه", "المجموعه", "group", "في", "فى"].includes(w));
  const scored = groups
    .map((g) => {
      const hay = normAr(`${g.subject.name} ${g.name} ${g.grade?.name ?? ""}`);
      let score = 0;
      if (nq && hay === nq) score += 10;
      if (normAr(g.name) === nq || normAr(g.subject.name) === nq) score += 6;
      for (const tok of tokens) {
        if (normAr(g.subject.name).includes(tok) || tok.includes(normAr(g.subject.name))) score += 3;
        if (normAr(g.name) === tok) score += 4;
        if (g.grade?.name && (normAr(g.grade.name).includes(tok) || tok.includes(normAr(g.grade.name)))) score += 2;
      }
      return { g, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    throw new ToolError("NOT_FOUND", `مفيش مجموعة مطابقة لـ «${q}» — جرب الاسم زي ما هو في شاشة المجموعات.`);
  }
  const top = scored[0].score;
  const tied = scored.filter((x) => x.score === top);
  if (tied.length > 1) {
    const opts = tied.slice(0, 4).map((x) => `${x.g.subject.name} — ${x.g.name}${x.g.grade?.name ? ` (${x.g.grade.name})` : ""}`);
    throw new ToolError("VALIDATION", `في أكتر من مجموعة مطابقة — حدد واحدة بالظبط: ${opts.join(" / ")}`);
  }
  const g = scored[0].g;
  return { id: g.id, name: g.name, subject: g.subject.name, grade: g.grade?.name ?? null };
}

register({
  name: "group.list",
  group: "groups",
  requiredModule: "students",
  description: "المجموعات النشطة في السنتر مع عدد الطلبة والمادة والمدرس",
  usageHint: "لما المستخدم يسأل «إيه المجموعات اللي عندي؟» أو محتاج يختار مجموعة",
  input: z.object({
    q: z.string().optional().describe("فلتر اختياري باسم المجموعة أو المادة"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENTS",
  permissionLabel: "عرض الطلاب",
  async handler(args, ctx): Promise<ToolOutput> {
    const groups = await db.group.findMany({
      where: {
        centerId: ctx.centerId,
        isActive: true,
        ...(args.q ? { OR: [{ name: { contains: args.q } }, { subject: { is: { name: { contains: args.q } } } }] } : {}),
      },
      select: {
        id: true, name: true,
        subject: { select: { name: true } },
        teacher: { select: { name: true } },
        _count: { select: { students: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { name: "asc" },
      take: 15,
    });
    if (!groups.length) {
      return { summary: args.q ? `مفيش مجموعة مطابقة لـ «${args.q}».` : "مفيش مجموعات نشطة في السنتر.", data: { count: 0 } };
    }
    return {
      summary: `في ${groups.length} ${groups.length === 1 ? "مجموعة" : "مجموعات"}${args.q ? ` مطابقة لـ «${args.q}»` : ""}: ${groups.slice(0, 6).map((g) => `${g.subject.name} — ${g.name}`).join("، ")}.`,
      data: { count: groups.length, groups: groups.map((g) => ({ id: g.id, name: g.name, subject: g.subject.name, teacher: g.teacher?.name, students: g._count.students })) },
      cards: [{
        type: "report",
        title: "المجموعات النشطة",
        items: groups.map((g) => ({
          id: g.id,
          title: `${g.subject.name} — ${g.name}`,
          sub: `المدرس ${g.teacher?.name ?? "—"} · ${g._count.students} طالب`,
          actions: [{ label: "اطلع تقرير المجموعة", action: "agent", text: `اعمللي تقرير عن مجموعة ${g.name}` }],
        })),
      }],
    };
  },
});

register({
  name: "group.enroll_student",
  group: "groups",
  requiredModule: "students",
  description: "سجّل طالب في مجموعة — بيفحص التكرار والسعة قبل التسجيل",
  usageHint: "«سجل أحمد في Group B» — بيقبل studentId و groupId (من أدوات البحث قبلها) أو الأسماء مباشرة studentName و groupName (زي «كيمياء — A») — لو الاسم مطابق لأكتر من واحدة هيسأل",
  input: z.object({
    studentId: z.string().min(1).optional(),
    studentName: z.string().min(1).max(120).optional(),
    groupId: z.string().min(1).optional(),
    groupName: z.string().min(1).max(120).optional(),
  }).refine((v) => !!v.studentId || !!v.studentName, { message: "محتاج studentId أو studentName" })
    .refine((v) => !!v.groupId || !!v.groupName, { message: "محتاج groupId أو groupName" }),
  risk: "MEDIUM",
  requiredPermission: "EDIT_STUDENT",
  permissionLabel: "تعديل بيانات طالب",
  async handler(args, ctx): Promise<ToolOutput> {
    // ==== فحوص ما قبل التنفيذ (spec §32) — مع دعم الأسماء المباشرة (الطالب/المجموعة بالمرونة) ====
    const { student, group } = await resolveEnrollRefs(args, ctx.centerId);
    if (student.status !== "ACTIVE") throw new ToolError("STATE", `الطالب ${student.name} مش نشط (${student.status}) — لازم يترجع نشط الأول.`);

    const existing = await db.studentGroup.findUnique({
      where: { studentId_groupId: { studentId: student.id, groupId: group.id } },
      select: { id: true, status: true },
    });
    if (existing && existing.status === "ACTIVE") {
      throw new ToolError("STATE", `${student.name} مسجل أصلاً في ${group.name} — مفيش حاجة تتغير.`);
    }

    // ==== التنفيذ ====
    if (existing) {
      await db.studentGroup.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
    } else {
      await db.studentGroup.create({
        data: { studentId: student.id, groupId: group.id, registeredBy: ctx.user.id },
      });
    }

    return {
      summary: `سجلت ${student.name} في ${group.subject.name} — ${group.name}.`,
      confirmSummary: `هسجل ${student.name} (كود ${student.code}) في مجموعة ${group.subject.name} — ${group.name}.`,
      data: { studentId: student.id, studentName: student.name, groupId: group.id, groupName: group.name, reactivated: !!existing },
    };
  },
  /** معاينة التأكيد — قراءة بس، صفر كتابة (spec §5) */
  async preview(args, ctx) {
    const { student, group } = await resolveEnrollRefs(args, ctx.centerId);
    return {
      summary: `هسجل ${student.name} (كود ${student.code}) في مجموعة ${group.subject.name} — ${group.name}.`,
      details: { student: student.name, code: student.code, group: `${group.subject.name} — ${group.name}` },
    };
  },
  // ==== تحقق ما بعد التنفيذ من الداتابيز نفسها (spec §34) ====
  async verify(args, _output, ctx) {
    const { student, group } = await resolveEnrollRefs(args, ctx.centerId);
    const reg = await db.studentGroup.findFirst({
      where: { studentId: student.id, groupId: group.id, status: "ACTIVE" },
      select: { id: true },
    });
    // centerId check عبر المجموعة
    if (!reg) return "التسجيل مظهرش في الداتابيز — حاول تاني.";
    if (group.centerId !== ctx.centerId) return "المجموعة خارج سنترك — راجع السجل.";
    return null;
  },
});

/**
 * حل مراجع التسجيل بمرونة (spec P3): ID مباشر أو اسم — المطابقة الضبابية سيرفر-سايد،
 * والتعدد بيرجع رسالة توضيح بالمترشحين (ممنوع التخمين — spec P5).
 */
async function resolveEnrollRefs(
  args: { studentId?: string; studentName?: string; groupId?: string; groupName?: string },
  centerId: string,
): Promise<{ student: { id: string; name: string; code: string; status: string }; group: { id: string; name: string; centerId: string; subject: { name: string } } }> {
  // ==== الطالب ====
  let student: { id: string; name: string; code: string; status: string } | null = null;
  if (args.studentId) {
    student = await db.student.findFirst({
      where: { id: args.studentId, centerId },
      select: { id: true, name: true, code: true, status: true },
    });
  }
  if (!student && args.studentName) {
    const nq = normAr(args.studentName);
    const cands = await db.student.findMany({
      where: { centerId, status: "ACTIVE" },
      select: { id: true, name: true, code: true, status: true },
      take: 200,
    });
    const hits = cands.filter((s) => {
      const ns = normAr(s.name);
      return ns === nq || ns.includes(nq) || nq.includes(ns);
    });
    if (hits.length === 1) student = hits[0];
    else if (hits.length > 1) {
      throw new ToolError("VALIDATION", `«${args.studentName}» مطابق لأكتر من طالب — حدد بالظبط: ${hits.slice(0, 4).map((s) => `${s.name} (${s.code})`).join(" / ")}`);
    }
  }
  if (!student) throw new ToolError("NOT_FOUND", `مفيش طالب مطابق لـ «${args.studentName ?? args.studentId ?? ""}» في السنتر.`);

  // ==== المجموعة ====
  let group: { id: string; name: string; centerId: string; subject: { name: string } } | null = null;
  if (args.groupId) {
    group = await db.group.findFirst({
      where: { id: args.groupId, centerId, isActive: true },
      select: { id: true, name: true, centerId: true, subject: { select: { name: true } } },
    });
  }
  if (!group && args.groupName) {
    const nq = normAr(args.groupName);
    const cands = await db.group.findMany({
      where: { centerId, isActive: true },
      select: { id: true, name: true, centerId: true, subject: { select: { name: true } } },
      take: 200,
    });
    const scored = cands
      .map((g) => {
        const hay = normAr(`${g.subject.name} ${g.name}`);
        const hayName = normAr(g.name);
        let score = 0;
        if (hay === nq || hayName === nq) score += 6;
        if (hay.includes(nq) || nq.includes(hay)) score += 4;
        if (hayName.includes(nq) || nq.includes(hayName)) score += 3;
        if (normAr(g.subject.name).includes(nq) || nq.includes(normAr(g.subject.name))) score += 2;
        return { g, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1) group = scored[0].g;
    else if (scored.length > 1 && scored[0].score > scored[1].score) group = scored[0].g;
    else if (scored.length > 1) {
      throw new ToolError("VALIDATION", `«${args.groupName}» مطابقة لأكتر من مجموعة — حدد بالظبط: ${scored.slice(0, 4).map((x) => `${x.g.subject.name} — ${x.g.name}`).join(" / ")}`);
    }
  }
  if (!group) throw new ToolError("NOT_FOUND", `مفيش مجموعة مطابقة لـ «${args.groupName ?? args.groupId ?? ""}» أو مش نشطة.`);

  return { student, group };
}

/* ================= مطابقة مادة/مرحلة/مدرس بالاسم ================= */

async function resolveGradeFlexible(q: string, centerId: string) {
  const grades = await db.grade.findMany({ where: { centerId }, select: { id: true, name: true }, take: 100 });
  const nq = normAr(q);
  const exact = grades.find((g) => normAr(g.name) === nq);
  if (exact) return exact;
  const partial = grades.filter((g) => normAr(g.name).includes(nq) || nq.includes(normAr(g.name)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError("VALIDATION", `في أكتر من مرحلة مطابقة لـ «${q}» — حدد بالظبط: ${partial.slice(0, 4).map((g) => g.name).join(" / ")}`);
  }
  throw new ToolError("NOT_FOUND", `مفيش مرحلة اسمها «${q}» — المراحل الموجودة: ${grades.slice(0, 6).map((g) => g.name).join(" / ")}`);
}

async function resolveSubjectFlexible(q: string, centerId: string) {
  const subjects = await db.subject.findMany({ where: { centerId }, select: { id: true, name: true }, take: 100 });
  const nq = normAr(q);
  const exact = subjects.find((s) => normAr(s.name) === nq);
  if (exact) return exact;
  const partial = subjects.filter((s) => normAr(s.name).includes(nq) || nq.includes(normAr(s.name)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError("VALIDATION", `في أكتر من مادة مطابقة لـ «${q}» — حدد بالظبط: ${partial.slice(0, 4).map((s) => s.name).join(" / ")}`);
  }
  throw new ToolError("NOT_FOUND", `مفيش مادة اسمها «${q}» — المواد الموجودة: ${subjects.slice(0, 6).map((s) => s.name).join(" / ")}`);
}

async function resolveTeacherFlexible(q: string, centerId: string) {
  const teachers = await db.teacher.findMany({ where: { centerId }, select: { id: true, name: true }, take: 200 });
  const nq = normAr(q.replace(/^أ\.?\s*/, ""));
  const exact = teachers.find((t) => normAr(t.name) === nq || normAr(t.name).replace(/^أ\.?\s*/, "") === nq);
  if (exact) return exact;
  const partial = teachers.filter((t) => normAr(t.name).includes(nq) || nq.includes(normAr(t.name)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError("VALIDATION", `في أكتر من مدرس مطابق لـ «${q}» — حدد بالظبط: ${partial.slice(0, 4).map((t) => t.name).join(" / ")}`);
  }
  throw new ToolError("NOT_FOUND", `مفيش مدرس اسمه «${q}» — جرب الاسم زي ما هو في شاشة المدرسين.`);
}

/** اسم قسم افتراضي (A/B/C…) مش مستخدم لنفس المادة والمرحلة — زي عرف الشاشة */
async function nextSectionName(subjectId: string, gradeId: string, centerId: string): Promise<string> {
  const same = await db.group.findMany({ where: { centerId, subjectId, gradeId }, select: { name: true }, take: 50 });
  const used = new Set(same.map((g) => normAr(g.name)));
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (!used.has(letter.toLowerCase())) return letter;
  }
  return "جديد";
}

register({
  name: "group.create",
  group: "groups",
  requiredModule: "students",
  description: "أنشئ مجموعة جديدة: مادة + مرحلة + سعر الحصة، ولو ذكرت مدرس تتسلم له — الاسم بيتولد أوتوماتيك (A/B/C) لو مش محدد",
  usageHint: "«اعمل مجموعة رياضيات للصف الأول الثانوي بسعر 60» — المادة والمرحلة والسعر مطلوبين والمدرس اختياري (بالاسم مش بالـ id)",
  input: z.object({
    subject: z.string().min(1).max(60).describe("اسم المادة زي «رياضيات»"),
    grade: z.string().min(1).max(60).describe("اسم المرحلة زي «الأول الثانوي»"),
    price: z.number().min(1).max(2000).describe("سعر الحصة بالجنيه المصري"),
    name: z.string().min(1).max(60).optional().describe("اسم المجموعة/القسم — افتراضي الحرف الجاي A/B/C"),
    teacher: z.string().max(60).optional().describe("اسم المدرس (اختياري)"),
    teacherPercent: z.number().int().min(0).max(100).optional().describe("نسبة المدرس — افتراضي 50"),
    room: z.string().max(60).optional().describe("القاعة (اختياري)"),
  }),
  risk: "HIGH",
  requiredPermission: "EDIT_GROUP",
  permissionLabel: "تعديل المجموعات",
  async handler(args, ctx): Promise<ToolOutput> {
    if (ctx.user.role !== "MANAGER") {
      throw new ToolError("PERMISSION", "إنشاء المجموعات للمدير بس — زي شاشة المجموعات بالظبط.");
    }
    const grade = await resolveGradeFlexible(args.grade, ctx.centerId);
    const subject = await resolveSubjectFlexible(args.subject, ctx.centerId);
    const teacher = args.teacher ? await resolveTeacherFlexible(args.teacher, ctx.centerId) : null;
    const name = args.name?.trim() || await nextSectionName(subject.id, grade.id, ctx.centerId);
    const dup = await db.group.findFirst({
      where: { centerId: ctx.centerId, subjectId: subject.id, gradeId: grade.id, name },
      select: { id: true },
    });
    if (dup) throw new ToolError("STATE", `مجموعة «${name}» موجودة أصلاً في ${subject.name} — ${grade.name}. اختار اسم تاني.`);
    const price = toPiastres(args.price);
    if (price <= 0) throw new ToolError("VALIDATION", "سعر الحصة لازم يكون أكبر من صفر.");
    if (price > toPiastres(2000)) throw new ToolError("VALIDATION", "سعر الحصة كبير بشكل غير منطقي — راجعه.");
    const pct = args.teacherPercent ?? 50;

    const group = await db.group.create({
      data: {
        centerId: ctx.centerId, name,
        gradeId: grade.id, subjectId: subject.id, teacherId: teacher?.id ?? null,
        sessionPrice: price, teacherPercent: pct, room: args.room?.trim() || null,
      },
    });
    await logAudit({
      user: ctx.user, action: AUDIT.GROUP_CREATED, entity: "GROUP", entityId: group.id,
      after: { name, subject: subject.name, grade: grade.name, price, teacherPercent: pct, via: "agent" },
    });
    return {
      summary: `أنشأت مجموعة ${subject.name} — ${name} (${grade.name}) بسعر ${args.price} ج/حصة${teacher ? ` — المدرس ${teacher.name}` : ""}.`,
      confirmSummary: `هأنشئ مجموعة ${subject.name} — ${name} (${grade.name}) بسعر ${args.price} ج/حصة${teacher ? ` والمدرس ${teacher.name}` : ""}.`,
      data: { groupId: group.id, name, subject: subject.name, grade: grade.name, pricePiastres: price, teacherPercent: pct },
    };
  },
  async preview(args, ctx) {
    if (ctx.user.role !== "MANAGER") throw new ToolError("PERMISSION", "إنشاء المجموعات للمدير بس.");
    const grade = await resolveGradeFlexible(args.grade, ctx.centerId);
    const subject = await resolveSubjectFlexible(args.subject, ctx.centerId);
    const teacher = args.teacher ? await resolveTeacherFlexible(args.teacher, ctx.centerId) : null;
    const name = args.name?.trim() || await nextSectionName(subject.id, grade.id, ctx.centerId);
    return {
      summary: `هأنشئ مجموعة ${subject.name} — ${name} (${grade.name}) بسعر ${args.price} ج/حصة${teacher ? ` والمدرس ${teacher.name}` : ""}.`,
      details: { المادة: subject.name, المرحلة: grade.name, الاسم: name, "سعر الحصة": `${args.price} ج`, المدرس: teacher?.name ?? "من غير", "نسبة المدرس": `${args.teacherPercent ?? 50}%`, ...(args.room ? { القاعة: args.room } : {}) },
    };
  },
  async verify(args, _output, ctx) {
    const grade = await resolveGradeFlexible(args.grade, ctx.centerId).catch(() => null);
    if (!grade) return null; // المرحلة اتشالت بعد الإنشاء — الداتا نفسها بتتكشف في الشاشة
    const g = await db.group.findFirst({
      where: { centerId: ctx.centerId, gradeId: grade.id, subjectId: (await resolveSubjectFlexible(args.subject, ctx.centerId).catch(() => null))?.id ?? undefined },
      orderBy: { createdAt: "desc" }, select: { id: true, sessionPrice: true, name: true },
    });
    if (!g) return "المجموعة الجديدة مظهرتش في الداتابيز.";
    const expected = toPiastres(args.price);
    if (g.sessionPrice !== expected) return `السعر المحفوظ (${g.sessionPrice / 100}) مش مطابق للمطلوب (${args.price}).`;
    return null;
  },
});

register({
  name: "group.update",
  group: "groups",
  requiredModule: "students",
  description: "عدّل مجموعة موجودة: الاسم أو المدرس أو سعر الحصة أو نسبة المدرس أو القاعة أو تفعيل/إيقاف",
  usageHint: "«غيّر سعر مجموعة رياضيات B لـ 70» / «وقف مجموعة الفيزياء A» — حدد المجموعة بالاسم/المادة وقيمة واحدة على الأقل للتغيير",
  input: z.object({
    group: z.string().min(1).max(80).describe("المجموعة — اسمها أو مادتها + الاسم زي «رياضيات B»"),
    name: z.string().min(1).max(60).optional(),
    teacher: z.string().max(60).optional().describe("اسم المدرس الجديد"),
    price: z.number().min(1).max(2000).optional().describe("سعر الحصة الجديد بالجنيه"),
    teacherPercent: z.number().int().min(0).max(100).optional(),
    room: z.string().max(60).optional(),
    isActive: z.boolean().optional().describe("false = وقف المجموعة · true = شغلها تاني"),
  }),
  risk: "MEDIUM",
  requiredPermission: "EDIT_GROUP",
  permissionLabel: "تعديل المجموعات",
  async handler(args, ctx): Promise<ToolOutput> {
    if (ctx.user.role !== "MANAGER") {
      throw new ToolError("PERMISSION", "تعديل المجموعات للمدير بس — زي شاشة المجموعات بالظبط.");
    }
    const g = await resolveGroupFlexible(args.group, ctx.centerId);
    const data: Record<string, unknown> = {};
    if (args.name !== undefined) data.name = args.name.trim();
    if (args.price !== undefined) {
      const price = toPiastres(args.price);
      if (price <= 0 || price > toPiastres(2000)) throw new ToolError("VALIDATION", "السعر لازم يكون من 1 لـ 2000 جنيه.");
      data.sessionPrice = price;
    }
    if (args.teacherPercent !== undefined) data.teacherPercent = args.teacherPercent;
    if (args.room !== undefined) data.room = args.room.trim() || null;
    if (args.isActive !== undefined) data.isActive = args.isActive;
    if (args.teacher !== undefined) {
      const teacher = args.teacher ? await resolveTeacherFlexible(args.teacher, ctx.centerId) : null;
      data.teacherId = teacher?.id ?? null;
    }
    if (!Object.keys(data).length) throw new ToolError("VALIDATION", "حدد حاجة تتغير على الأقل (اسم/سعر/مدرس/نسبة/قاعة/تفعيل).");

    const before = await db.group.findUnique({ where: { id: g.id }, select: { sessionPrice: true, teacherPercent: true, isActive: true, name: true } });
    await db.group.update({ where: { id: g.id }, data });
    await logAudit({
      user: ctx.user, action: AUDIT.GROUP_UPDATED, entity: "GROUP", entityId: g.id,
      before: before ?? undefined, after: data, reason: "تعديل مجموعة عن طريق زكي",
    });
    const label = `${g.subject} — ${g.name}`;
    const changes: string[] = [];
    if (data.name) changes.push(`الاسم بقى «${data.name}»`);
    if (data.sessionPrice !== undefined) changes.push(`السعر بقى ${args.price} ج`);
    if (data.teacherPercent !== undefined) changes.push(`نسبة المدرس بقى ${args.teacherPercent}%`);
    if (data.teacherId !== undefined) changes.push(`المدرس بقى ${args.teacher ? args.teacher : "اتشال"}`);
    if (data.room !== undefined) changes.push(`القاعة بقى ${args.room || "—"}`);
    if (data.isActive !== undefined) changes.push(data.isActive ? "المجموعة بقت نشطة" : "المجموعة اتوقفت");
    return {
      summary: `عدّلت ${label}: ${changes.join(" · ")}.`,
      confirmSummary: `هعدّل مجموعة ${label}: ${changes.join(" · ")}.`,
      data: { groupId: g.id, changes: data },
    };
  },
  async preview(args, ctx) {
    if (ctx.user.role !== "MANAGER") throw new ToolError("PERMISSION", "تعديل المجموعات للمدير بس.");
    const g = await resolveGroupFlexible(args.group, ctx.centerId);
    const full = await db.group.findUnique({
      where: { id: g.id },
      select: { name: true, sessionPrice: true, teacherPercent: true, isActive: true, teacher: { select: { name: true } }, subject: { select: { name: true } }, grade: { select: { name: true } } },
    });
    if (!full) throw new ToolError("NOT_FOUND", "المجموعة مش موجودة.");
    return {
      summary: `هعدّل مجموعة ${full.subject.name} — ${full.name} (${full.grade?.name ?? "—"}).`,
      details: {
        "الحالة الحالية": `سعر ${full.sessionPrice / 100} ج · نسبة ${full.teacherPercent}% · مدرس ${full.teacher?.name ?? "—"} · ${full.isActive ? "نشطة" : "موقوفة"}`,
        ...(args.price !== undefined ? { "السعر الجديد": `${args.price} ج` } : {}),
        ...(args.teacherPercent !== undefined ? { "النسبة الجديدة": `${args.teacherPercent}%` } : {}),
        ...(args.teacher !== undefined ? { "المدرس الجديد": args.teacher } : {}),
        ...(args.name !== undefined ? { "الاسم الجديد": args.name } : {}),
        ...(args.room !== undefined ? { "القاعة الجديدة": args.room } : {}),
        ...(args.isActive !== undefined ? { "الحالة الجديدة": args.isActive ? "نشطة" : "موقوفة" } : {}),
      },
    };
  },
  async verify(args, _output, ctx) {
    const g = await resolveGroupFlexible(args.group, ctx.centerId).catch(() => null);
    if (!g) return "المجموعة مظهرتش بعد التعديل.";
    const after = await db.group.findUnique({ where: { id: g.id }, select: { sessionPrice: true, isActive: true } });
    if (!after) return "المجموعة اختفت من الداتابيز.";
    if (args.price !== undefined && after.sessionPrice !== toPiastres(args.price)) return "السعر الجديد محفوظش صح.";
    if (args.isActive !== undefined && after.isActive !== args.isActive) return "حالة التفعيل محفوظتش صح.";
    return null;
  },
});
