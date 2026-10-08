import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";

/* ============================================================
   TOOLS: المجموعات — group.list / group.enroll_student
   التسجيل (enroll) أداة كتابة MEDIUM: كل فحوص ما قبل التنفيذ
   (spec §32) + verify من الداتابيز (spec §34)
============================================================ */

register({
  name: "group.list",
  group: "groups",
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
  description: "سجّل طالب في مجموعة — بيفحص التكرار والسعة قبل التسجيل",
  usageHint: "«سجل أحمد في Group B» — محتاج studentId و groupId (ييجوا من أدوات بحث قبلها)",
  input: z.object({
    studentId: z.string().min(1),
    groupId: z.string().min(1),
  }),
  risk: "MEDIUM",
  requiredPermission: "EDIT_STUDENT",
  permissionLabel: "تعديل بيانات طالب",
  async handler(args, ctx): Promise<ToolOutput> {
    // ==== فحوص ما قبل التنفيذ (spec §32) ====
    const student = await db.student.findFirst({
      where: { id: args.studentId, centerId: ctx.centerId },
      select: { id: true, name: true, code: true, status: true },
    });
    if (!student) throw new ToolError("NOT_FOUND", "الطالب ده مش موجود في السنتر.");
    if (student.status !== "ACTIVE") throw new ToolError("STATE", `الطالب ${student.name} مش نشط (${student.status}) — لازم يترجع نشط الأول.`);

    const group = await db.group.findFirst({
      where: { id: args.groupId, centerId: ctx.centerId, isActive: true },
      select: { id: true, name: true, subject: { select: { name: true } }, _count: { select: { students: { where: { status: "ACTIVE" } } } } },
    });
    if (!group) throw new ToolError("NOT_FOUND", "المجموعة دي مش موجودة أو مش نشطة.");
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
    const student = await db.student.findFirst({
      where: { id: args.studentId, centerId: ctx.centerId },
      select: { name: true, code: true },
    });
    const group = await db.group.findFirst({
      where: { id: args.groupId, centerId: ctx.centerId },
      select: { name: true, subject: { select: { name: true } } },
    });
    if (!student || !group) throw new ToolError("NOT_FOUND", "الطالب أو المجموعة مش موجودين في السنتر.");
    return {
      summary: `هسجل ${student.name} (كود ${student.code}) في مجموعة ${group.subject.name} — ${group.name}.`,
      details: { student: student.name, code: student.code, group: `${group.subject.name} — ${group.name}` },
    };
  },
  // ==== تحقق ما بعد التنفيذ من الداتابيز نفسها (spec §34) ====
  async verify(args, _output, ctx) {
    const reg = await db.studentGroup.findFirst({
      where: { studentId: args.studentId, groupId: args.groupId, status: "ACTIVE" },
      select: { id: true },
    });
    // centerId check عبر المجموعة
    if (!reg) return "التسجيل مظهرش في الداتابيز — حاول تاني.";
    const g = await db.group.findUnique({ where: { id: args.groupId }, select: { centerId: true } });
    if (!g || g.centerId !== ctx.centerId) return "المجموعة خارج سنترك — راجع السجل.";
    return null;
  },
});
