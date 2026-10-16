import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";
import { todayStr, toPiastres } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import { logAudit, AUDIT } from "@/lib/audit";

/* ============================================================
   TOOL: التحصيل — finance.get_collection
   إجمالي المدفوعات في فترة. صلاحية مالية إجبارية (سيرفري) +
   قراءة فقط + محصور بالسنتر. المبالغ بالقروش في الداتابيز.
============================================================ */

const ymd = /^\d{4}-\d{2}-\d{2}$/;

register({
  name: "finance.get_collection",
  group: "finance",
  requiredModule: "finance",
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

/* ============================================================
   TOOL: تسجيل دفعة — finance.record_payment
   نفس قواعد POST /api/payments (PAYMENT بس — الاسترداد/التسوية
   ليهم صلاحيات وموافقات خاصة بره الوكيل): صلاحية RECORD_PAYMENT،
   حد المبلغ، طريقة الدفع، إيصال RC متسلسل، إشعار الطالب، تدقيق.
============================================================ */

register({
  name: "finance.record_payment",
  group: "finance",
  requiredModule: "finance",
  description: "سجّل دفعة فلوس لطالب (كاش/فودافون/انستاباي) — بإيصال رسمي متسلسل وتحديث رصيد",
  usageHint: "«سجل دفعة 50 جنيه لأحمد» / «استلمت 200 من كود 99002 فودافون» — محتاج الطالب والمبلغ",
  input: z.object({
    student: z.string().min(1).max(80).describe("الطالب بالاسم أو الكود"),
    amount: z.number().min(0.5).max(100_000).describe("المبلغ بالجنيه المصري"),
    method: z.enum(["CASH", "VODAFONE", "INSTAPAY"]).optional().describe("طريقة الدفع — افتراضي كاش"),
    note: z.string().max(200).optional().describe("ملاحظة على الدفعة (اختياري)"),
  }),
  risk: "HIGH",
  requiredPermission: "RECORD_PAYMENT",
  permissionLabel: "تسجيل الدفعات",
  async handler(args, ctx): Promise<ToolOutput> {
    const { resolveStudentFlexible } = await import("./students");
    const student = await resolveStudentFlexible(args.student, ctx.centerId);
    const egp = args.amount;
    if (!isFinite(egp) || egp <= 0) throw new ToolError("VALIDATION", "المبلغ لازم يكون أكبر من صفر.");
    if (Math.abs(egp) > 100_000) throw new ToolError("VALIDATION", "المبلغ ده كبير بشكل غير منطقي — راجعه تاني.");
    const method = args.method ?? "CASH";
    const signed = toPiastres(egp);
    if (signed <= 0) throw new ToolError("VALIDATION", "المبلغ صغير أوي — أقل دفعة نص جنيه.");

    const before = await studentBalance(student.id);
    const { txn, receipt, after } = await db.$transaction(async (tx) => {
      const created = await tx.studentTransaction.create({
        data: {
          centerId: ctx.centerId, studentId: student.id, sessionId: null,
          type: "PAYMENT", amount: signed, method, reason: args.note?.trim() || null, createdBy: ctx.user.id,
        },
      });
      // إيصال متسلسل لكل سنتر (RC-000001) — نفس نمط الـ API الرسمي
      const last = await tx.receipt.findFirst({ where: { centerId: ctx.centerId }, orderBy: { seq: "desc" }, select: { seq: true } });
      const seq = (last?.seq ?? 0) + 1;
      const r = await tx.receipt.create({
        data: {
          centerId: ctx.centerId, seq, number: `RC-${String(seq).padStart(6, "0")}`,
          txnId: created.id, studentId: student.id, amount: signed, method,
          balanceBefore: before, balanceAfter: before + signed,
          sessionId: null, issuedBy: ctx.user.id, issuedByName: ctx.user.name, date: todayStr(),
        },
      });
      return { txn: created, receipt: r, after: before + signed };
    });

    // إشعار الطالب في البورتال + Push — best-effort زي الـ API بالظبط
    const amountLabel = (signed / 100).toLocaleString("en-EG");
    const notifTitle = "دفعة جديدة";
    const notifBody = after > 0
      ? `وصلنا ${amountLabel} ج — رصيدك بقى ${(after / 100).toLocaleString("en-EG")} ج.`
      : after < 0
        ? `وصلنا ${amountLabel} ج — الباقي عليك ${(-after / 100).toLocaleString("en-EG")} ج.`
        : `وصلنا ${amountLabel} ج — سدّدت كل حاجة`;
    try {
      await db.studentNotification.create({
        data: { centerId: ctx.centerId, studentId: student.id, type: "PAYMENT", title: notifTitle, body: notifBody },
      });
      const { sendPushToStudents } = await import("@/lib/push");
      void sendPushToStudents(ctx.centerId, [student.id], {
        title: notifTitle, body: notifBody, url: "/portal", tag: `pay-${txn.id}`,
      }).catch(() => {});
    } catch { /* best-effort */ }

    await logAudit({
      user: ctx.user, action: AUDIT.PAYMENT_RECORDED, entity: "STUDENT_TRANSACTION", entityId: txn.id,
      after: { student: student.name, type: "PAYMENT", amount: signed, method, receipt: receipt.number, via: "agent" },
    });

    const fmt = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
    return {
      summary: `سجلت دفعة ${fmt(signed)} ج (${method === "CASH" ? "كاش" : method === "VODAFONE" ? "فودافون كاش" : "انستاباي"}) لـ ${student.name} — إيصال ${receipt.number}. رصيده بقى ${after >= 0 ? `${fmt(after)} ج له` : `${fmt(-after)} ج عليه`}.`,
      confirmSummary: `هسجل دفعة ${fmt(signed)} ج لـ ${student.name} (كود ${student.code}) — ${method === "CASH" ? "كاش" : method === "VODAFONE" ? "فودافون كاش" : "انستاباي"}${args.note ? ` — ملاحظة: ${args.note}` : ""}.`,
      data: { txnId: txn.id, receipt: receipt.number, studentId: student.id, amountPiastres: signed, method, balanceAfter: after },
      cards: [{
        type: "result", title: `✓ دفعة ${fmt(signed)} ج — ${student.name}`,
        rows: [
          { label: "الإيصال", value: receipt.number },
          { label: "الطريقة", value: method === "CASH" ? "كاش" : method === "VODAFONE" ? "فودافون كاش" : "انستاباي" },
          { label: "الرصيد بعد الدفعة", value: after >= 0 ? `${fmt(after)} ج له` : `${fmt(-after)} ج عليه`, tone: after < 0 ? "warn" : "good" },
          ...(args.note ? [{ label: "ملاحظة", value: args.note }] : []),
        ],
        actions: [{ label: "افتح ملف الطالب", action: "navigate" as const, view: "students", studentId: student.id }],
      }],
    };
  },
  async preview(args, ctx) {
    const { resolveStudentFlexible } = await import("./students");
    const student = await resolveStudentFlexible(args.student, ctx.centerId);
    const before = await studentBalance(student.id);
    const fmt = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
    const after = before + toPiastres(args.amount);
    const methodLabel = args.method === "VODAFONE" ? "فودافون كاش" : args.method === "INSTAPAY" ? "انستاباي" : "كاش";
    return {
      summary: `هسجل دفعة ${args.amount} ج لـ ${student.name} (كود ${student.code}) — ${methodLabel}.`,
      details: {
        الطالب: `${student.name} (${student.code})`,
        المبلغ: `${args.amount} ج`,
        "الطريقة": args.method === "VODAFONE" ? "فودافون كاش" : args.method === "INSTAPAY" ? "انستاباي" : "كاش",
        "الرصيد الحالي": before >= 0 ? `${fmt(before)} ج له` : `${fmt(-before)} ج عليه`,
        "الرصيد بعد الدفعة": after >= 0 ? `${fmt(after)} ج له` : `${fmt(-after)} ج عليه`,
        الإيصال: "هيتولد أوتوماتيك (RC)",
      },
    };
  },
  async verify(args, output, ctx) {
    const txnId = (output.data?.txnId as string) ?? null;
    if (!txnId) return "مفيش معرف دفعة في النتيجة.";
    const txn = await db.studentTransaction.findFirst({
      where: { id: txnId, centerId: ctx.centerId, type: "PAYMENT" }, select: { id: true, amount: true, studentId: true },
    });
    if (!txn) return "الدفعة مظهرتش في الداتابيز.";
    if (txn.amount !== toPiastres(args.amount)) return "مبلغ الدفعة المحفوظ مش مطابق.";
    const receipt = await db.receipt.findFirst({ where: { txnId: txn.id }, select: { number: true } });
    if (!receipt) return "الدفعة اتسجلت بس من غير إيصال.";
    return null;
  },
});

/* ============================================================
   TOOLS: قراءات مالية — مدينين / مصروفات / إيصالات / مستحقات مدرسين
   قراءة فقط (LOW) — أرقام حتمية من الداتابيز، الموديل بيرجع بيها زي ما هي.
   دي كانت فجوة حقيقية: أسئلة «مين المدينين؟ / المصروفات كام؟» كانت
   بتسقط في التخمين أو الـ fallback — دلوقتي ليها أداة رسمية بنتيجة مضبوطة.
============================================================ */

/** تحويل قروش → نص جنيه بدقة (بدون تقريب مخلّ) */
function fmtEgp(p: number): string {
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}
const MONTH_START = () => `${todayStr().slice(0, 7)}-01`;

register({
  name: "finance.get_debtors",
  group: "finance",
  requiredModule: "finance",
  description: "قائمة المديونين: الطلاب اللي رصيدهم سالب (عليهم فلوس) — مرتبين من الأعلى مديونية، بالأسماء والأكواد والمبالغ + إجمالي المديونية وعددهم",
  usageHint: "«مين أكبر المدينين؟» / «كام طالب مديونين؟» / «الطلاب اللي عليهم فلوس بالترتيب» / «رصيد سالب»",
  input: z.object({
    limit: z.number().int().min(1).max(25).optional().describe("عدد الأسماء المعروضة — افتراضي 10"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENT_FINANCIAL_STATUS",
  permissionLabel: "عرض الحالة المالية للطالب",
  async handler(args, ctx): Promise<ToolOutput> {
    const limit = args.limit ?? 10;
    const agg = await db.studentTransaction.groupBy({
      by: ["studentId"],
      where: { centerId: ctx.centerId },
      _sum: { amount: true },
      having: { amount: { _sum: { lt: 0 } } },
      orderBy: { _sum: { amount: "asc" } },
      take: limit,
    });
    const totalAgg = await db.studentTransaction.groupBy({
      by: ["studentId"],
      where: { centerId: ctx.centerId },
      _sum: { amount: true },
      having: { amount: { _sum: { lt: 0 } } },
    });
    if (!totalAgg.length) {
      return { summary: "مفيش مديونين — كل الأرصدة سليمة.", data: { count: 0, debtors: [], totalDebtPiastres: 0 } };
    }
    const studs = await db.student.findMany({ where: { id: { in: agg.map((a) => a.studentId) }, centerId: ctx.centerId }, select: { id: true, name: true, code: true } });
    const totalDebt = totalAgg.reduce((s, a) => s + (a._sum?.amount ?? 0), 0);
    const debtors = agg.map((a) => {
      const s = studs.find((x) => x.id === a.studentId);
      return { id: a.studentId, name: s?.name ?? "طالب", code: s?.code ?? "—", balancePiastres: a._sum?.amount ?? 0 };
    });
    return {
      summary: `${totalAgg.length} طالب عليهم رصيد سالب — إجمالي المديونية ${fmtEgp(Math.abs(totalDebt))} ج. أكبرهم: ${debtors[0].name} (${fmtEgp(Math.abs(debtors[0].balancePiastres))} ج)${debtors.length > 1 ? ` وبعده ${debtors[1].name}` : ""}.`,
      data: { count: totalAgg.length, totalDebtPiastres: totalDebt, debtors },
      cards: [{
        type: "report", title: `أكبر ${debtors.length} مديونيات`,
        rows: debtors.map((d) => ({ label: `${d.name} (كود ${d.code})`, value: `${fmtEgp(Math.abs(d.balancePiastres))} ج عليه`, tone: "bad" as const })),
        actions: [{ label: "الطلاب", action: "navigate" as const, view: "students", studentId: debtors[0].id }],
      }],
    };
  },
});

register({
  name: "finance.get_expenses",
  group: "finance",
  requiredModule: "finance",
  requiredRole: "MANAGER",
  description: "إجمالي مصروفات السنتر في فترة (إيجار/كهرباء/مرتبات/صيانة/مستلزمات/أخرى) بالتفصيل والنوع — للسنتر كله",
  usageHint: "«المصروفات كام؟» / «صرفنا كام الشهر ده؟» / «مصاريف من 2026-10-01 لـ 2026-10-15» — من غير تواريخ = من أول الشهر لليوم",
  input: z.object({
    from: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("بداية الفترة (افتراضي أول الشهر)"),
    to: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("نهاية الفترة شاملة (افتراضي النهاردة)"),
  }),
  risk: "LOW",
  async handler(args, ctx): Promise<ToolOutput> {
    const from = args.from ?? MONTH_START();
    const to = args.to ?? todayStr();
    if (to < from) return { summary: "تاريخ النهاية قبل البداية — راجع الفترة.", data: { error: "range" } };
    const rows = await db.expense.groupBy({ by: ["category"], where: { centerId: ctx.centerId, date: { gte: from, lte: to } }, _sum: { amount: true }, _count: true });
    const total = rows.reduce((s, r) => s + (r._sum.amount ?? 0), 0);
    const count = rows.reduce((s, r) => s + r._count, 0);
    if (!count) {
      return { summary: `مفيش مصروفات مسجلة من ${from} لـ ${to}.`, data: { from, to, totalPiastres: 0, count: 0, byCategory: [] } };
    }
    const catLabel: Record<string, string> = { RENT: "إيجار", ELECTRICITY: "كهرباء", SALARIES: "مرتبات", MAINTENANCE: "صيانة", SUPPLIES: "مستلزمات", OTHER: "أخرى" };
    const byCategory = rows.map((r) => ({ category: r.category, label: catLabel[r.category] ?? r.category, piastres: r._sum.amount ?? 0, count: r._count })).sort((a, b) => b.piastres - a.piastres);
    return {
      summary: `مصروفات ${from} → ${to}: ${fmtEgp(total)} ج (${count} مصروف). أكبر بند: ${byCategory[0].label} بـ ${fmtEgp(byCategory[0].piastres)} ج.`,
      data: { from, to, totalPiastres: total, count, byCategory },
      cards: [{
        type: "report", title: `المصروفات ${from} → ${to}`,
        rows: byCategory.map((c) => ({ label: c.label, value: `${fmtEgp(c.piastres)} ج (${c.count})`, tone: "info" as const })),
        actions: [{ label: "المصروفات", action: "navigate" as const, view: "reports" }],
      }],
    };
  },
});

register({
  name: "finance.get_receipts",
  group: "finance",
  requiredModule: "finance",
  description: "إيصالات الدفع: عددها وإجمالي مبالغها في فترة (أو من أول الشهر) — آخر 5 إيصالات بأرقامها الرسمية",
  usageHint: "«كام إيصال اتصرف؟» / «إيصالات النهاردة» / «إيصالات من 2026-10-01 لـ 2026-10-10» — من غير تواريخ = من أول الشهر",
  input: z.object({
    from: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("بداية الفترة (افتراضي أول الشهر)"),
    to: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("نهاية الفترة شاملة (افتراضي النهاردة)"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENT_FINANCIAL_STATUS",
  permissionLabel: "عرض الحالة المالية للطالب",
  async handler(args, ctx): Promise<ToolOutput> {
    const from = args.from ?? MONTH_START();
    const to = args.to ?? todayStr();
    if (to < from) return { summary: "تاريخ النهاية قبل البداية — راجع الفترة.", data: { error: "range" } };
    const agg = await db.receipt.aggregate({ where: { centerId: ctx.centerId, date: { gte: from, lte: to } }, _sum: { amount: true }, _count: true });
    const last = await db.receipt.findMany({ where: { centerId: ctx.centerId }, orderBy: { seq: "desc" }, take: 5, select: { number: true, amount: true, date: true, issuedByName: true } });
    const total = agg._sum.amount ?? 0;
    return {
      summary: agg._count
        ? `اتصرف ${agg._count} إيصال من ${from} لـ ${to} بإجمالي ${fmtEgp(total)} ج. آخر إيصال ${last[0]?.number ?? "—"} (${fmtEgp(last[0]?.amount ?? 0)} ج).`
        : `مفيش إيصالات من ${from} لـ ${to}.`,
      data: { from, to, count: agg._count, totalPiastres: total, latest: last },
      cards: [{
        type: "report", title: `الإيصالات ${from} → ${to}`,
        rows: [
          { label: "العدد", value: String(agg._count), tone: "info" },
          { label: "الإجمالي", value: `${fmtEgp(total)} ج`, tone: "good" },
          ...(last.length ? [{ label: "آخر إيصال", value: `${last[0].number} — ${fmtEgp(last[0].amount)} ج` }] : []),
        ],
        actions: [{ label: "الإيصالات", action: "navigate" as const, view: "payments" }],
      }],
    };
  },
});

register({
  name: "finance.get_teacher_settlements",
  group: "finance",
  requiredModule: "finance",
  description: "مستحقات المدرسين: إجمالي اللي اتحسب ليهم (مستحق) واللي اتصرح لهم (مدفوع) وصافي المستحق الحالي + أعلى المدرسين مستحقات في الفترة",
  usageHint: "«مستحقات المدرسين كام؟» / «اتصرف للمدرسين كام الشهر ده؟» / «مين أكبر مدرس مستحقاته؟»",
  input: z.object({
    from: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("بداية الفترة (افتراضي أول الشهر)"),
    to: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("نهاية الفترة شاملة (افتراضي النهاردة)"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_REPORTS",
  permissionLabel: "عرض التقارير",
  async handler(args, ctx): Promise<ToolOutput> {
    const from = args.from ?? MONTH_START();
    const to = args.to ?? todayStr();
    if (to < from) return { summary: "تاريخ النهاية قبل البداية — راجع الفترة.", data: { error: "range" } };
    const rows = await db.teacherSettlement.findMany({
      where: { centerId: ctx.centerId, date: { gte: from, lte: to } },
      select: { type: true, amount: true, teacherId: true },
    });
    const earned = rows.filter((r) => r.type === "EARNED").reduce((s, r) => s + r.amount, 0);
    const paid = rows.filter((r) => r.type === "PAID").reduce((s, r) => s + r.amount, 0);
    const perTeacher = new Map<string, number>();
    for (const r of rows) if (r.type === "EARNED") perTeacher.set(r.teacherId, (perTeacher.get(r.teacherId) ?? 0) + r.amount);
    const topIds = [...perTeacher.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const teachers = topIds.length ? await db.teacher.findMany({ where: { id: { in: topIds.map(([id]) => id) }, centerId: ctx.centerId }, select: { id: true, name: true } }) : [];
    const top = topIds.map(([id, amt]) => ({ name: teachers.find((t) => t.id === id)?.name ?? "مدرس", earnedPiastres: amt }));
    return {
      summary: rows.length
        ? `مستحقات المدرسين ${from} → ${to}: اتحسب ${fmtEgp(earned)} ج، اتصرف ${fmtEgp(Math.abs(paid))} ج — الباقي المستحق دلوقتي ${fmtEgp(earned + paid)} ج.${top.length ? ` أكبرهم: ${top[0].name} (${fmtEgp(top[0].earnedPiastres)} ج).` : ""}`
        : `مفيش مستحقات مدرسين مسجلة من ${from} لـ ${to}.`,
      data: { from, to, earnedPiastres: earned, paidPiastres: paid, netPayablePiastres: earned + paid, topEarned: top },
      cards: [{
        type: "report", title: `مستحقات المدرسين ${from} → ${to}`,
        rows: [
          { label: "اتحسب ليهم", value: `${fmtEgp(earned)} ج`, tone: "info" },
          { label: "اتصرف لهم", value: `${fmtEgp(Math.abs(paid))} ج`, tone: "good" },
          { label: "المتبقي المستحق", value: `${fmtEgp(earned + paid)} ج`, tone: earned + paid > 0 ? "warn" : "good" },
          ...(top.length ? [{ label: "أعلى مستحقات", value: top.map((t) => `${t.name} (${fmtEgp(t.earnedPiastres)}ج)`).join(" · ") }] : []),
        ],
        actions: [{ label: "التقارير", action: "navigate" as const, view: "reports" }],
      }],
    };
  },
});
