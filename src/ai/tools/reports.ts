import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";

/* ============================================================
   TOOLS: التقارير — reports.get_student_report
   التقرير بيتجمّع من نفس مصادر شاشة التقارير: حضور + مدفوعات + كويزات
   البيانات المالية بتظهر بس لمعتها VIEW_STUDENT_FINANCIAL_STATUS
============================================================ */

register({
  name: "reports.get_student_report",
  group: "reports",
  description: "تقرير طالب: نسبة حضوره، آخر غياباته، رصيده، وآخر كويزاته",
  usageHint: "«اعمللي تقرير عن أحمد» — محتاج studentId (من أداة بحث قبلها) أو كوده",
  input: z.object({
    studentId: z.string().optional(),
    code: z.string().optional(),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_REPORTS",
  permissionLabel: "عرض التقارير",
  async handler(args, ctx): Promise<ToolOutput> {
    if (!args.studentId && !args.code) {
      throw new ToolError("VALIDATION", "حدد الطالب (studentId أو كوده).");
    }
    const student = await db.student.findFirst({
      where: {
        centerId: ctx.centerId,
        ...(args.studentId ? { id: args.studentId } : { code: args.code }),
      },
      select: { id: true, name: true, code: true, grade: { select: { name: true } } },
    });
    if (!student) throw new ToolError("NOT_FOUND", "الطالب ده مش موجود في السنتر.");

    // ==== الحضور ====
    const att = await db.attendance.findMany({
      where: { studentId: student.id },
      select: { status: true, session: { select: { date: true, group: { select: { name: true, subject: { select: { name: true } } } } } } },
      orderBy: { id: "desc" },
      take: 200,
    });
    const total = att.length;
    const presentCount = att.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
    const absentCount = att.filter((a) => a.status === "ABSENT").length;
    const rate = total ? Math.round((presentCount / total) * 100) : null;
    const recentAbsences = att.filter((a) => a.status === "ABSENT").slice(0, 5)
      .map((a) => `${a.session?.group?.subject.name ?? "—"} ${a.session?.date ?? ""}`.trim());

    // ==== المالية (مش معروضة من غير صلاحية) ====
    const hasFin = ctx.user.role === "MANAGER" || ctx.user.permissions.includes("VIEW_STUDENT_FINANCIAL_STATUS");
    let balancePiastres: number | null = null;
    let lastPayment: { amount: number; at: string } | null = null;
    if (hasFin) {
      const bal = await db.studentTransaction.aggregate({ where: { studentId: student.id }, _sum: { amount: true } });
      balancePiastres = bal._sum.amount ?? 0;
      const last = await db.studentTransaction.findFirst({
        where: { studentId: student.id, type: "PAYMENT" },
        orderBy: { createdAt: "desc" },
        select: { amount: true, createdAt: true },
      });
      lastPayment = last ? { amount: last.amount, at: last.createdAt.toISOString().slice(0, 10) } : null;
    }

    // ==== آخر الكويزات ====
    const quizzes = await db.quizAttempt.findMany({
      where: { studentId: student.id, status: "GRADED", score: { not: null } },
      select: { score: true, maxScore: true, createdAt: true, quiz: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const quizRows = quizzes
      .filter((q) => (q.maxScore ?? 0) > 0)
      .map((q) => ({ title: q.quiz?.title ?? "كويز", pct: Math.round(((q.score ?? 0) / (q.maxScore ?? 1)) * 100) }));

    const rows: { label: string; value: string; tone?: "good" | "warn" | "bad" | "info" }[] = [
      { label: "نسبة الحضور", value: rate != null ? `${rate}% (${presentCount}/${total})` : "مفيش حضور", tone: rate != null && rate < 70 ? "warn" : "good" },
      { label: "الغياب المسجل", value: `${absentCount} مرة`, tone: absentCount >= 3 ? "bad" : "info" },
    ];
    if (hasFin && balancePiastres != null) {
      rows.push({ label: "الرصيد", value: `${Math.round(Math.abs(balancePiastres) / 100)} ${balancePiastres < 0 ? "ج عليه" : "ج له"}`, tone: balancePiastres < 0 ? "bad" : "good" });
      if (lastPayment) rows.push({ label: "آخر دفعة", value: `${Math.round(lastPayment.amount / 100)}ج — ${lastPayment.at}` });
    }
    if (quizRows.length) {
      const avg = Math.round(quizRows.reduce((s, q) => s + q.pct, 0) / quizRows.length);
      rows.push({ label: "متوسط آخر كويزات", value: `${avg}% (${quizRows.length} كويز)`, tone: avg < 60 ? "warn" : "good" });
    }

    return {
      summary: `تقرير ${student.name} (كود ${student.code})${student.grade?.name ? ` — ${student.grade.name}` : ""}: حضور ${rate != null ? rate + "%" : "—"}، غياب ${absentCount} مرة${hasFin && balancePiastres != null ? `، رصيد ${Math.round(Math.abs(balancePiastres) / 100) / 10 >= 0 ? Math.round(Math.abs(balancePiastres) / 100) : 0}ج` : ""}.`.replace("  ", " "),
      data: {
        student: { id: student.id, name: student.name, code: student.code },
        attendance: { total, presentCount, absentCount, rate },
        recentAbsences,
        ...(hasFin ? { balancePiastres, lastPayment } : {}),
        quizzes: quizRows,
      },
      cards: [{
        type: "report",
        title: `تقرير ${student.name} (كود ${student.code})`,
        subtitle: student.grade?.name ?? undefined,
        rows,
        actions: [
          { label: "فتح ملف الطالب", action: "navigate", view: "students", studentId: student.id },
        ],
      }],
    };
  },
});
