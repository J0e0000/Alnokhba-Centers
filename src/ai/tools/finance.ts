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
