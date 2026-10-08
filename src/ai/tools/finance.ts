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
    // مجاميع حقيقية — لو فيه قروش مش بنقرّبها (150.50 مش 151)
    const egp = piastres % 100 === 0 ? String(piastres / 100) : (piastres / 100).toFixed(2);
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
