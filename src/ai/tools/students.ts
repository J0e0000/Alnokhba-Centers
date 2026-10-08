import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput, type AgentCard } from "./types";
import { normalizeDigits } from "@/lib/normalize";

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
