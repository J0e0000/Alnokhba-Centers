import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import type { ToolOutput } from "./types";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   TOOL: التحصيل — finance.get_collection
   إجمالي المدفوعات في فترة. صلاحية مالية إجبارية (سيرفري) +
   قراءة فقط + محصور بالسنتر. المبالغ بالقروش في الداتابيز.
============================================================ */

const ymd = /^\d{4}-\d{2}-\d{2}$/;

register({
  name: "finance.get_collection",
  group: "finance",
  description: "إجمالي التحصيل (المدفوعات المستلمة) في فترة — يوم أو من تاريخ لتاريخ",
  usageHint: "«حصّلنا كام النهاردة؟» / «تحصيل الأسبوع» / «إيراد من 2026-10-01 لـ 2026-10-07» — لو من غير تواريخ يبقى النهاردة",
  input: z.object({
    from: z.string().regex(ymd, "من تاريخ YYYY-MM-DD").optional().describe("بداية الفترة YYYY-MM-DD (افتراضي النهاردة)"),
    to: z.string().regex(ymd, "إلى تاريخ YYYY-MM-DD").optional().describe("نهاية الفترة YYYY-MM-DD شاملة (افتراضي = from)"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENT_FINANCIAL_STATUS",
  permissionLabel: "عرض الحالة المالية للطالب",
  async handler(args, ctx): Promise<ToolOutput> {
    const from = args.from ?? todayStr();
    const to = args.to ?? from;
    if (to < from) {
      return { summary: "تاريخ النهاية قبل البداية — راجع الفترة.", data: { error: "range" } };
    }
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    const agg = await db.studentTransaction.aggregate({
      where: { centerId: ctx.centerId, type: "PAYMENT", createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    });
    const piastres = agg._sum.amount ?? 0;
    const egp = Math.round(piastres / 100);
    const label = from === to ? from : `${from} → ${to}`;
    return {
      summary: `التحصيل ${label}: ${egp} جنيه (${agg._count} دفعة).`,
      data: { from, to, collectionPiastres: piastres, payments: agg._count },
      cards: [{
        type: "report", title: `التحصيل ${label}`,
        rows: [{ label: "الإجمالي", value: `${egp} جنيه`, tone: "good" }, { label: "عدد الدفعات", value: String(agg._count) }],
      }],
    };
  },
});

/* ============================================================
   TOOL: المديونيات — finance.debtors
   الطلاب اللي عليهم رصيد سالب (الرصيد = مجموع الـ ledger). قراءة فقط.
============================================================ */
register({
  name: "finance.debtors",
  group: "finance",
  description: "الطلاب النشطين اللي عليهم فلوس (رصيد سالب) مرتبين من الأكبر — مع إجمالي المديونية",
  usageHint: "«مين عليه فلوس؟» / «المتأخرات» / «أكبر المديونيات» — limit افتراضي 10، أقصى 25",
  input: z.object({
    limit: z.number().int().min(1).max(25).optional().describe("عدد الطلاب (افتراضي 10)"),
    minEgp: z.number().min(0).optional().describe("حد أدنى للمديونية بالجنيه (افتراضي 1)"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENT_FINANCIAL_STATUS",
  permissionLabel: "عرض الحالة المالية للطالب",
  async handler(args, ctx): Promise<ToolOutput> {
    const limit = args.limit ?? 10;
    const minPiastres = Math.round((args.minEgp ?? 1) * 100);
    const grouped = await db.studentTransaction.groupBy({
      by: ["studentId"],
      where: { centerId: ctx.centerId },
      _sum: { amount: true },
    });
    const owing = grouped
      .map((g) => ({ studentId: g.studentId, owed: -(g._sum.amount ?? 0) }))
      .filter((g) => g.owed >= minPiastres);
    if (!owing.length) {
      return { summary: "مفيش طلاب عليهم مديونية.", data: { count: 0, totalOwedPiastres: 0, students: [] } };
    }
    const students = await db.student.findMany({
      where: { centerId: ctx.centerId, status: "ACTIVE", id: { in: owing.map((o) => o.studentId) } },
      select: { id: true, name: true, code: true },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    const rows = owing
      .filter((o) => byId.has(o.studentId))
      .sort((a, b) => b.owed - a.owed);
    const total = rows.reduce((s, r) => s + r.owed, 0);
    const top = rows.slice(0, limit).map((r) => ({ ...byId.get(r.studentId)!, owedPiastres: r.owed }));
    return {
      summary: `${rows.length} طالب عليهم مديونية بإجمالي ${Math.round(total / 100)} جنيه. الأعلى: ${top[0].name} (${Math.round(top[0].owedPiastres / 100)}ج).`,
      data: { count: rows.length, totalOwedPiastres: total, students: top },
      cards: [{
        type: "students",
        title: `المديونيات — ${rows.length} طالب`,
        subtitle: `الإجمالي ${Math.round(total / 100)} جنيه`,
        items: top.map((s) => ({
          id: s.id, title: s.name, sub: `كود ${s.code} · عليه ${Math.round(s.owedPiastres / 100)} جنيه`,
          actions: [{ label: "ملف الطالب", action: "navigate" as const, view: "students", studentId: s.id }],
        })),
      }],
    };
  },
});
