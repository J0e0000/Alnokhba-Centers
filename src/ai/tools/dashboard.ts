import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import type { ToolOutput } from "./types";
import { runZakiRules } from "@/lib/zaki";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   TOOLS: الداشبورد — dashboard.get_today
   إيه اللي حصل النهارده + أهم ملاحظات زكي الحتمية (نفس قواعد
   /api/zaki — مصدر حقيقة واحد)
============================================================ */

register({
  name: "dashboard.get_today",
  group: "dashboard",
  requiredModule: "sessions",
  description: "ملخص النهاردة: حصص اليوم وحالتها، الحضور، التحصيل، وأهم ملاحظات التحليل",
  usageHint: "«إيه اللي حصل النهارده؟» / «إيه أهم حاجة محتاجة متابعة؟» / «وريني الملخص»",
  input: z.object({
    withInsights: z.boolean().optional().describe("جيب كمان أهم ملاحظات زكي (افتراضي true)"),
  }),
  risk: "LOW",
  async handler(args, ctx): Promise<ToolOutput> {
    const today = todayStr();
    const withInsights = args.withInsights !== false;

    // ==== حصص النهاردة ====
    const sessions = await db.sessionInstance.findMany({
      where: { centerId: ctx.centerId, date: today },
      select: {
        id: true, status: true, startTime: true, endTime: true,
        group: { select: { name: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } },
        _count: { select: { attendance: true } },
      },
      orderBy: { startTime: "asc" },
    });
    const open = sessions.filter((s) => s.status === "OPEN");
    const closed = sessions.filter((s) => s.status === "CLOSED");
    const cancelled = sessions.filter((s) => s.status === "CANCELLED");

    // ==== الحضور النهاردة ====
    const marks = await db.attendance.findMany({
      where: { session: { centerId: ctx.centerId, date: today } },
      select: { status: true },
    });
    const present = marks.filter((m) => m.status === "PRESENT" || m.status === "LATE").length;

    // ==== التحصيل النهاردة (لو معاه صلاحية مالية) ====
    const hasFin = ctx.user.role === "MANAGER" || ctx.user.permissions.includes("VIEW_STUDENT_FINANCIAL_STATUS");
    let collectionPiastres: number | null = null;
    if (hasFin) {
      const agg = await db.studentTransaction.aggregate({
        where: { centerId: ctx.centerId, type: "PAYMENT", createdAt: { gte: new Date(`${today}T00:00:00`) } },
        _sum: { amount: true },
      });
      collectionPiastres = agg._sum.amount ?? 0;
    }

    // ==== ملاحظات زكي (حتمية — نفس /api/zaki) ====
    const insights = withInsights ? (await runZakiRules(ctx.centerId)).findings.slice(0, 4) : [];

    const rows = [
      { label: "حصص النهاردة", value: `${sessions.length} (${open.length} مفتوحة · ${closed.length} مقفولة${cancelled.length ? ` · ${cancelled.length} ملغاة` : ""})` },
      { label: "حضور اليوم", value: `${present} تسجيل` },
      ...(collectionPiastres != null ? [{ label: "التحصيل", value: `${Math.round(collectionPiastres / 100)} جنيه` }] : []),
    ];
    const summaryBits = [
      sessions.length
        ? `النهاردة ${sessions.length} حصة (${open.length} لسه مفتوحة، ${closed.length} اتقفلت)`
        : "مفيش حصص مجدولة النهاردة",
      `الحضور ${present} تسجيل`,
      ...(collectionPiastres != null ? [`التحصيل ${Math.round(collectionPiastres / 100)}ج`] : []),
      ...(insights.length ? [`وأهم ملاحظة: ${insights[0].what}`] : []),
    ];
    return {
      summary: `${summaryBits.join(" · ")}.`,
      data: {
        date: today,
        sessions: sessions.map((s) => ({
          id: s.id, status: s.status, startTime: s.startTime, endTime: s.endTime,
          group: s.group?.name, subject: s.group?.subject.name, teacher: s.group?.teacher?.name,
          attendanceCount: s._count.attendance,
        })),
        attendanceToday: { total: marks.length, present },
        ...(collectionPiastres != null ? { collectionPiastres } : {}),
        insights: insights.map((f) => ({ id: f.id, severity: f.severity, what: f.what, where: f.where, why: f.why, action: f.action })),
      },
      cards: [
        {
          type: "report",
          title: `ملخص ${today}`,
          rows,
          actions: [
            { label: "حصص اليوم", action: "navigate", view: "today" },
            { label: "التقارير", action: "navigate", view: "reports" },
          ],
        },
        ...insights.map((f) => ({
          type: "insight" as const,
          title: f.what,
          subtitle: f.where,
          severity: f.severity,
          rows: [
            { label: "ليه", value: f.why },
            { label: "اقتراح", value: f.action },
          ],
        })),
      ],
    };
  },
});
