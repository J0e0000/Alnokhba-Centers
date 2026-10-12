import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolContext, type ToolOutput } from "./types";
import { todayStr, toPiastres, toEGP, normalizeDigits } from "@/lib/normalize";
import { logAudit, AUDIT } from "@/lib/audit";
import { getSubscriptionState } from "@/lib/entitlements";
import { recordUndo } from "@/lib/undo";
import { APPROVAL_TYPES, type ApprovalType } from "@/lib/permissions";

/* ============================================================
   TOOLS: عمليات الإدارة — مصروفات، موافقات، كتب، حالة الطلاب،
   إعلانات، امتحانات، سجل العمليات، حالة الاشتراك (spec §3)
   كل أداة: صلاحية/دور واضح + استحقاق قسم + تدقيق + تأكيد للحساس.
   المدير بس في الحساسات الإدارية — والباقي على قدرة الصلاحيات.
============================================================ */

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

/** حاجز الدور: أدوات الإدارة دي للمدير بس (زي requireManager في الـ API) */
function requireManagerCtx(ctx: ToolContext): void {
  if (ctx.user.role !== "MANAGER") {
    throw new ToolError("PERMISSION", "العملية دي لمدير السنتر بس.");
  }
}

/* ============================================================
   TOOL: تسجيل مصروف — finance.record_expense (مدير بس)
============================================================ */

const EXPENSE_CATEGORIES = ["RENT", "ELECTRICITY", "SALARIES", "MAINTENANCE", "SUPPLIES", "OTHER"] as const;
const EXPENSE_LABELS: Record<string, string> = {
  RENT: "إيجار", ELECTRICITY: "كهرباء/مرافق", SALARIES: "مرتبات",
  MAINTENANCE: "صيانة", SUPPLIES: "مستلزمات", OTHER: "أخرى",
};

register({
  name: "finance.record_expense",
  group: "finance",
  requiredModule: "finance",
  requiredRole: "MANAGER",
  description: "سجّل مصروف للسنتر (إيجار/كهرباء/مرتبات/صيانة/مستلزمات) — يدخل دفتر السنتر وقابل للتراجع",
  usageHint: "«سجل مصروف كهرباء 800 جنيه» / «صرفنا 250 على صيانة» — مدير السنتر بس",
  input: z.object({
    amount: z.number().min(0.5).max(500_000).describe("المبلغ بالجنيه المصري"),
    category: z.enum(EXPENSE_CATEGORIES).optional().describe("نوع المصروف — افتراضي OTHER"),
    note: z.string().max(200).optional().describe("ملاحظة على المصروف"),
    date: z.string().regex(ymd).optional().describe("التاريخ YYYY-MM-DD — افتراضي النهاردة"),
  }),
  risk: "HIGH",
  permissionLabel: "تسجيل المصروفات (مدير)",
  async handler(args, ctx): Promise<ToolOutput> {
    requireManagerCtx(ctx);
    const amount = toPiastres(args.amount);
    if (amount <= 0) throw new ToolError("VALIDATION", "قيمة المصروف لازم تكون أكبر من صفر.");
    const category = args.category ?? "OTHER";
    const date = args.date ?? todayStr();
    const note = args.note?.trim() || null;

    const expense = await db.expense.create({
      data: { centerId: ctx.centerId, category, amount, date, note, createdBy: ctx.user.id },
    });
    await db.centerTransaction.create({
      data: { centerId: ctx.centerId, type: "EXPENSE", amount: -amount, date, note: note || category, refType: "EXPENSE", refId: expense.id, createdBy: ctx.user.id },
    });
    await recordUndo({
      user: ctx.user, entity: "EXPENSE", entityId: expense.id, action: "CREATE",
      label: `إضافة مصروف ${EXPENSE_LABELS[category]} — ${fmt(amount)} ج`,
      forward: { id: expense.id, centerId: ctx.centerId, category, amount, date, note, createdBy: ctx.user.id },
      inverse: { id: expense.id },
    });
    await logAudit({
      user: ctx.user, action: AUDIT.EXPENSE_ADDED, entity: "EXPENSE", entityId: expense.id,
      after: { category, amount, date, via: "agent" },
    });
    return {
      summary: `سجلت مصروف ${EXPENSE_LABELS[category]} بـ ${fmt(amount)} ج — دخل دفتر السنتر.`,
      confirmSummary: `هسجل مصروف ${EXPENSE_LABELS[category]} بـ ${args.amount} ج${note ? ` — ${note}` : ""}.`,
      data: { expenseId: expense.id, category, amountPiastres: amount, date },
      cards: [{
        type: "result", title: `✓ مصروف ${EXPENSE_LABELS[category]} — ${fmt(amount)} ج`,
        rows: [
          { label: "النوع", value: EXPENSE_LABELS[category] },
          { label: "التاريخ", value: date },
          ...(note ? [{ label: "ملاحظة", value: note }] : []),
        ],
      }],
    };
  },
  async preview(args, ctx) {
    requireManagerCtx(ctx);
    const category = args.category ?? "OTHER";
    return {
      summary: `هسجل مصروف ${EXPENSE_LABELS[category]} بـ ${args.amount} ج${args.note ? ` — ${args.note}` : ""}.`,
      details: {
        النوع: EXPENSE_LABELS[category],
        المبلغ: `${args.amount} ج`,
        التاريخ: args.date ?? todayStr(),
        ...(args.note ? { ملاحظة: args.note } : {}),
      },
    };
  },
});

/* ============================================================
   TOOLS: طلبات الموافقة — approvals.list + approvals.decide (مدير بس)
============================================================ */

const APPROVAL_TYPE_LABEL: Record<string, string> = {
  REFUND: "استرداد فلوس", ADJUSTMENT: "تسوية رصيد", SESSION_CANCEL: "إلغاء حصة",
  STUDENT_CANCEL: "أرشفة طالب", REGISTRATION_CANCEL: "إلغاء تسجيل من مجموعة",
};

register({
  name: "approvals.list",
  group: "approvals",
  requiredRole: "MANAGER",
  description: "اعرض طلبات الموافقة المستنية (استردادات/تسويات/إلغاءات) اللي مستنية قرارك",
  usageHint: "«في طلبات مستنية؟» / «اعرضلي الطلبات الجديدة» — مدير السنتر بس",
  input: z.object({
    status: z.enum(["PENDING", "ALL"]).optional().describe("PENDING (افتراضي) أو ALL لآخر الطلبات مهما كانت حالتها"),
  }),
  risk: "LOW",
  permissionLabel: "طلبات الموافقة (مدير)",
  async handler(args, ctx): Promise<ToolOutput> {
    requireManagerCtx(ctx);
    const pending = args.status ?? "PENDING";
    const rows = await db.approvalRequest.findMany({
      where: { centerId: ctx.centerId, ...(pending === "PENDING" ? { status: "PENDING" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    const pendingCount = await db.approvalRequest.count({ where: { centerId: ctx.centerId, status: "PENDING" } });
    if (!rows.length) {
      return { summary: pending === "PENDING" ? "مفيش طلبات مستنية قرار — كله تمام." : "مفيش طلبات خلاص.", data: { pendingCount } };
    }
    const studentIds = [...new Set(rows.map((r) => r.studentId).filter(Boolean))] as string[];
    const students = studentIds.length ? await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true, code: true } }) : [];
    const sMap = new Map(students.map((s) => [s.id, s]));
    return {
      summary: pending === "PENDING"
        ? `فيه ${rows.length} طلب مستني قرارك.${rows.length === 1 ? "" : " أقربهم من " + rows[rows.length - 1].requestedByName + "."}`
        : `آخر ${rows.length} طلب (${pendingCount} مستني دلوقتي).`,
      data: { pendingCount, requests: rows.map((r) => ({ id: r.id, number: r.number, type: r.type, status: r.status, amount: r.amount, requestedBy: r.requestedByName, reason: r.reason })) },
      cards: [{
        type: "students", title: pending === "PENDING" ? `طلبات مستنية (${rows.length})` : "آخر الطلبات",
        items: rows.map((r) => {
          const st = r.studentId ? sMap.get(r.studentId) : undefined;
          return {
            id: r.id,
            title: `${r.number} — ${APPROVAL_TYPE_LABEL[r.type] ?? r.type}${r.amount ? ` (${toEGP(Math.abs(r.amount)).toLocaleString("en-EG")} ج)` : ""}`,
            sub: `${st ? `${st.name} (${st.code}) — ` : ""}من ${r.requestedByName}: ${r.reason}`,
            actions: [{ label: "اعرض في شاشة الموافقات", action: "navigate" as const, view: "approvals" }],
          };
        }),
      }],
    };
  },
});

register({
  name: "approvals.decide",
  group: "approvals",
  requiredRole: "MANAGER",
  description: "اعتمد أو ارفض طلب موافقة مستني (الاعتماد بينفّذ العملية فورًا — استرداد/تسوية/إلغاء)",
  usageHint: "«اعتمد الطلب» / «ارفض الطلب — السبب كذا» — اعتمد قبله بـ approvals.list عشان تعرف رقم الطلب",
  input: z.object({
    requestId: z.string().min(1).max(40).describe("معرف الطلب (من approvals.list أو رقم AR-XXXXXX)"),
    action: z.enum(["approve", "reject"]).describe("القرار"),
    note: z.string().max(300).optional().describe("ملاحظة القرار — إجبارية في الرفض (السبب)"),
  }),
  risk: "HIGH",
  permissionLabel: "قرار طلبات الموافقة (مدير)",
  async handler(args, ctx): Promise<ToolOutput> {
    requireManagerCtx(ctx);
    if (args.action === "reject" && (!args.note || args.note.trim().length < 3)) {
      throw new ToolError("VALIDATION", "اكتب سبب الرفض (3 حروف على الأقل) — عشان الموظف يفهم.");
    }
    // بيقبل id داخلي أو رقم AR-XXXXXX
    let request = await db.approvalRequest.findFirst({ where: { id: args.requestId, centerId: ctx.centerId } });
    if (!request) {
      request = await db.approvalRequest.findFirst({ where: { number: args.requestId.toUpperCase(), centerId: ctx.centerId } });
    }
    if (!request) throw new ToolError("NOT_FOUND", "الطلب ده مش موجود.");
    const type = request.type as ApprovalType;
    if (!APPROVAL_TYPES[type]) throw new ToolError("STATE", "نوع الطلب ده مش معروف.");
    if (request.status !== "PENDING") throw new ToolError("STATE", `الطلب ده اتقرر فيه خلاص (${request.status}) — مينفعش يتقرر مرتين.`);

    const note = args.note?.trim() || null;
    const payload = JSON.parse(request.payload || "{}") as { amountEgp?: number; sessionId?: string; groupId?: string; note?: string };

    // claim شرطي — ضغطتين/جهازين = مرة واحدة بس (نفس نمط الـ API الرسمي)
    const result = await db.$transaction(async (tx) => {
      const claim = await tx.approvalRequest.updateMany({
        where: { id: request!.id, status: "PENDING" },
        data: {
          status: args.action === "approve" ? "APPROVED" : "REJECTED",
          decidedBy: ctx.user.id, decidedByName: ctx.user.name, decidedAt: new Date(), decisionNote: note,
        },
      });
      if (claim.count !== 1) throw new ToolError("STATE", "الطلب ده اتقرر فيه خلاص — مينفعش يتقرر مرتين.");
      let executedTxnId: string | null = null;
      let executedNote = note;

      if (args.action === "approve") {
        if (type === "REFUND" || type === "ADJUSTMENT") {
          const studentId = request!.studentId;
          const egp = payload.amountEgp ?? 0;
          if (!studentId || !egp) {
            executedNote = `${executedNote ?? ""} · بيانات التنفيذ ناقصة — راجع الطلب يدويًا`.trim();
          } else {
            const signed = type === "REFUND" ? -toPiastres(egp) : toPiastres(egp);
            const txn = await tx.studentTransaction.create({
              data: {
                centerId: ctx.centerId, studentId, sessionId: null,
                type, amount: signed, method: "CASH",
                reason: `${APPROVAL_TYPE_LABEL[type]} بقرار المدير — ${request!.number} — السبب: ${request!.reason}${note ? ` · ${note}` : ""}`,
                createdBy: ctx.user.id,
              },
            });
            executedTxnId = txn.id;
          }
        } else if (type === "SESSION_CANCEL") {
          const sess = await tx.sessionInstance.findFirst({ where: { id: payload.sessionId ?? "", centerId: ctx.centerId } });
          if (!sess) executedNote = `${executedNote ?? ""} · الحصة مش موجودة`.trim();
          else if (sess.status !== "OPEN") executedNote = `${executedNote ?? ""} · الحصة مش مفتوحة (${sess.status}) — متلغيتش`.trim();
          else await tx.sessionInstance.update({ where: { id: sess.id }, data: { status: "CANCELLED" } });
        } else if (type === "STUDENT_CANCEL") {
          const st = await tx.student.findFirst({ where: { id: request!.studentId ?? "", centerId: ctx.centerId } });
          if (!st) executedNote = `${executedNote ?? ""} · الطالب مش موجود`.trim();
          else if (st.status !== "ACTIVE") executedNote = `${executedNote ?? ""} · الطالب مش نشاط أصلًا`.trim();
          else await tx.student.update({ where: { id: st.id }, data: { status: "ARCHIVED" } });
        } else if (type === "REGISTRATION_CANCEL") {
          const reg = await tx.studentGroup.findFirst({
            where: { studentId: request!.studentId ?? "", groupId: payload.groupId ?? "", status: "ACTIVE" },
          });
          if (!reg) executedNote = `${executedNote ?? ""} · التسجيل مش موجود أو اتلغى قبل كده`.trim();
          else await tx.studentGroup.update({ where: { id: reg.id }, data: { status: "CANCELLED" } });
        }
        await tx.approvalRequest.update({ where: { id: request!.id }, data: { executedTxnId, decisionNote: executedNote } });
      }
      return { executedTxnId, executedNote };
    });

    await logAudit({
      user: ctx.user,
      action: args.action === "approve"
        ? (type === "REFUND" ? AUDIT.REFUND_ISSUED : type === "ADJUSTMENT" ? AUDIT.ADJUSTMENT_MADE : "اعتماد طلب موافقة")
        : "رفض طلب موافقة",
      entity: "APPROVAL_REQUEST", entityId: request.id,
      before: { status: "PENDING", type, amount: request.amount, requestedBy: request.requestedByName },
      after: { status: args.action === "approve" ? "APPROVED" : "REJECTED", executedTxnId: result.executedTxnId, note: result.executedNote, via: "agent" },
      reason: `${args.action === "approve" ? "اعتماد" : "رفض"} ${request.number} — طلب من ${request.requestedByName}: ${request.reason}`,
    });

    const amountLabel = request.amount ? ` (${toEGP(Math.abs(request.amount)).toLocaleString("en-EG")} ج)` : "";
    return {
      summary: args.action === "approve"
        ? `اعتمدت ${request.number}${amountLabel} — والعملية اتنفذت فورًا.`
        : `رفضت ${request.number}${amountLabel} — مفيش أي تغيير مالي.`,
      confirmSummary: `ه${args.action === "approve" ? "اعتمد" : "ارفض"} الطلب ${request.number} (${APPROVAL_TYPE_LABEL[type]}${amountLabel}) — طلب ${request.requestedByName}.`,
      data: { requestId: request.id, status: args.action === "approve" ? "APPROVED" : "REJECTED", executedTxnId: result.executedTxnId },
      cards: [{
        type: "result",
        title: `${args.action === "approve" ? "✓ اتعمد" : "✕ اترفض"} ${request.number}`,
        rows: [
          { label: "النوع", value: APPROVAL_TYPE_LABEL[type] ?? type },
          ...(request.amount ? [{ label: "الأثر المالي", value: `${toEGP(Math.abs(request.amount)).toLocaleString("en-EG")} ج` }] : []),
          { label: "طالبه", value: request.requestedByName },
          ...(result.executedNote ? [{ label: "ملاحظة", value: result.executedNote }] : []),
        ],
        actions: [{ label: "افتح شاشة الموافقات", action: "navigate" as const, view: "approvals" }],
      }],
    };
  },
  async preview(args, ctx) {
    requireManagerCtx(ctx);
    let request = await db.approvalRequest.findFirst({ where: { id: args.requestId, centerId: ctx.centerId } })
      ?? await db.approvalRequest.findFirst({ where: { number: args.requestId.toUpperCase(), centerId: ctx.centerId } });
    if (!request) throw new ToolError("NOT_FOUND", "الطلب ده مش موجود.");
    const payload = JSON.parse(request.payload || "{}") as { amountEgp?: number; sessionLabel?: string; groupLabel?: string };
    return {
      summary: `ه${args.action === "approve" ? "اعتمد" : "ارفض"} الطلب ${request.number} (${APPROVAL_TYPE_LABEL[request.type] ?? request.type}) — طلب ${request.requestedByName}.`,
      details: {
        الطلب: request.number,
        النوع: APPROVAL_TYPE_LABEL[request.type] ?? request.type,
        ...(request.amount ? { الأثر_المالي: `${fmt(Math.abs(request.amount))} ج` } : {}),
        السبب: request.reason,
        ...(payload.amountEgp ? { المبلغ: `${payload.amountEgp} ج` } : {}),
        ...(payload.sessionLabel ? { الحصة: payload.sessionLabel } : {}),
        ...(payload.groupLabel ? { المجموعة: payload.groupLabel } : {}),
        القرار: args.action === "approve" ? "اعتماد وتنفيذ فوري" : `رفض${args.note ? ` — ${args.note}` : " (اكتب سبب)"}`,
      },
    };
  },
});

/* ============================================================
   TOOL: بيع كتاب — books.sell_book (أي موظف سنتر — زي الـ API)
============================================================ */

register({
  name: "books.sell_book",
  group: "books",
  requiredModule: "books",
  description: "سجّل بيع كتاب (من المخزون) لطالب أو زبون — بيخصم المخزون ويدخل إيراد الكتب",
  usageHint: "«بعت كتاب رياضيات لطالب أحمد» / «سجل بيع كتابين لزبون اسمه محمود»",
  input: z.object({
    book: z.string().min(1).max(80).describe("الكتاب بالاسم (أول تطابق)"),
    qty: z.number().int().min(1).max(999).optional().describe("الكمية — افتراضي 1"),
    student: z.string().max(80).optional().describe("الطالب المشتري بالاسم/الكود (اختياري)"),
    buyerName: z.string().max(80).optional().describe("اسم الزبون لو مش طالب"),
    method: z.enum(["CASH", "VODAFONE", "INSTAPAY"]).optional().describe("طريقة الدفع — افتراضي كاش"),
    note: z.string().max(200).optional().describe("ملاحظة"),
  }),
  risk: "HIGH",
  permissionLabel: "بيع الكتب",
  async handler(args, ctx): Promise<ToolOutput> {
    const { resolveStudentFlexible } = await import("./students");
    const book = await db.book.findFirst({
      where: {
        centerId: ctx.centerId, isActive: true,
        name: { contains: normalizeDigits(args.book.trim()) },
      },
    });
    if (!book) throw new ToolError("NOT_FOUND", `مفيش كتاب اسمه فيه «${args.book}» — جرب اسم أدق أو شوف المخزون.`);
    const qty = args.qty ?? 1;
    if (qty > book.stock) throw new ToolError("STATE", `المتاح من «${book.name}» ${book.stock} بس.`);
    let studentId: string | null = null;
    let buyerName: string | null = args.buyerName?.trim() || null;
    if (args.student) {
      const st = await resolveStudentFlexible(args.student, ctx.centerId);
      studentId = st.id; buyerName = st.name;
    }
    if (!studentId && !buyerName) throw new ToolError("VALIDATION", "اكتب الطالب المشتري أو اسم الزبون.");
    const method = args.method ?? "CASH";
    const total = book.price * qty;
    const date = todayStr();

    const sale = await db.$transaction(async (tx) => {
      const fresh = await tx.book.findUnique({ where: { id: book.id } });
      if (!fresh || !fresh.isActive || fresh.stock < qty) {
        throw new ToolError("STATE", `المتاح من «${book.name}» اتغير — المتاح ${fresh?.stock ?? 0} بس.`);
      }
      await tx.book.update({ where: { id: book.id }, data: { stock: fresh.stock - qty } });
      const s = await tx.bookSale.create({
        data: {
          centerId: ctx.centerId, bookId: book.id, studentId, buyerName,
          qty, unitPrice: book.price, unitCost: fresh.costPrice, total, method, date,
          note: args.note?.trim() || null, createdBy: ctx.user.id,
        },
      });
      await tx.centerTransaction.create({
        data: {
          centerId: ctx.centerId, type: "BOOK_SALE", amount: total, date,
          note: `بيع ${qty}× ${book.name}${buyerName ? ` — ${buyerName}` : ""}`,
          refType: "BOOK_SALE", refId: s.id, createdBy: ctx.user.id,
        },
      });
      return s;
    });

    await logAudit({
      user: ctx.user, action: AUDIT.BOOK_SOLD, entity: "BOOK_SALE", entityId: sale.id,
      after: { book: book.name, qty, total, buyer: buyerName, method, via: "agent" },
    });

    return {
      summary: `سجلت بيع ${qty}× «${book.name}» بـ ${fmt(total)} ج لـ ${buyerName} — الباقي في المخزن ${book.stock - qty}.`,
      confirmSummary: `هسجل بيع ${qty}× «${book.name}» (${fmt(book.price)} ج للنسخة = ${fmt(total)} ج) لـ ${buyerName ?? "زبون"}.`,
      data: { saleId: sale.id, bookId: book.id, qty, totalPiastres: total, remainingStock: book.stock - qty },
      cards: [{
        type: "result", title: `✓ بيع كتاب — ${fmt(total)} ج`,
        rows: [
          { label: "الكتاب", value: book.name },
          { label: "الكمية", value: String(qty) },
          { label: "المشتري", value: buyerName ?? "—" },
          { label: "المخزون بعد البيع", value: String(book.stock - qty), tone: book.stock - qty <= 3 ? "warn" : "good" },
        ],
      }],
    };
  },
  async preview(args, ctx) {
    const book = await db.book.findFirst({
      where: { centerId: ctx.centerId, isActive: true, name: { contains: normalizeDigits(args.book.trim()) } },
    });
    if (!book) throw new ToolError("NOT_FOUND", `مفيش كتاب اسمه فيه «${args.book}».`);
    const qty = args.qty ?? 1;
    let buyer: string | null = args.buyerName?.trim() || null;
    if (args.student) {
      const { resolveStudentFlexible } = await import("./students");
      buyer = (await resolveStudentFlexible(args.student, ctx.centerId)).name;
    }
    return {
      summary: `هسجل بيع ${qty}× «${book.name}» بـ ${fmt(book.price * qty)} ج${buyer ? ` لـ ${buyer}` : ""}.`,
      details: {
        الكتاب: book.name,
        الكمية: String(qty),
        "سعر النسخة": `${fmt(book.price)} ج`,
        الإجمالي: `${fmt(book.price * qty)} ج`,
        المشتري: buyer ?? "زبون (اكتب الاسم)",
        "المخزون الحالي": `${book.stock}`,
      },
    };
  },
});

/* ============================================================
   TOOL: حالة الطالب — students.set_status (أرشفة/تفعيل)
============================================================ */

register({
  name: "students.set_status",
  group: "students",
  requiredModule: "students",
  description: "أرشف طالب (بيوقف حسابه ومن portals) أو فعّل طالب مؤرشف تاني",
  usageHint: "«أرشف الطالب أحمد» / «فعّل الطالب اللي كوده 10003» — محتاج صلاحية أرشفة",
  input: z.object({
    student: z.string().min(1).max(80).describe("الطالب بالاسم أو الكود"),
    action: z.enum(["archive", "activate"]).describe("archive = أرشفة، activate = تفعيل"),
    reason: z.string().max(300).optional().describe("سبب الحالة (بيتسجل في التدقيق)"),
  }),
  risk: "HIGH",
  requiredPermission: "ARCHIVE_STUDENT",
  permissionLabel: "أرشفة/إيقاف الطلاب",
  async handler(args, ctx): Promise<ToolOutput> {
    const { resolveStudentFlexible } = await import("./students");
    const student = await resolveStudentFlexible(args.student, ctx.centerId);
    const row = await db.student.findUnique({ where: { id: student.id }, select: { status: true } });
    const current = row?.status ?? "ACTIVE";
    const target = args.action === "archive" ? "ARCHIVED" : "ACTIVE";
    if (current === target) {
      return { summary: `الطالب ${student.name} ${args.action === "archive" ? "مؤرشف أصلًا" : "نشاط أصلًا"} — مفيش تغيير.`, data: { studentId: student.id, status: current } };
    }
    await db.student.update({ where: { id: student.id }, data: { status: target } });
    await logAudit({
      user: ctx.user, action: AUDIT.STUDENT_STATUS_CHANGED,
      entity: "STUDENT", entityId: student.id,
      before: { status: current }, after: { status: target },
      reason: args.reason?.trim() || "عبر زكي",
    });
    return {
      summary: `${args.action === "archive" ? "أرشفت" : "فعّلت"} الطالب ${student.name}${args.reason ? ` — ${args.reason}` : ""}.`,
      confirmSummary: `ه${args.action === "archive" ? "أرشف" : "فعّل"} الطالب ${student.name} (كود ${student.code})${args.reason ? ` — السبب: ${args.reason}` : ""}.`,
      data: { studentId: student.id, status: target },
      cards: [{
        type: "result", title: `${args.action === "archive" ? "✓ الطالب مؤرشف" : "✓ الطالب نشط"} — ${student.name}`,
        actions: [{ label: "افتح ملف الطالب", action: "navigate" as const, view: "students", studentId: student.id }],
      }],
    };
  },
  async preview(args, ctx) {
    const { resolveStudentFlexible } = await import("./students");
    const student = await resolveStudentFlexible(args.student, ctx.centerId);
    const row = await db.student.findUnique({ where: { id: student.id }, select: { status: true } });
    return {
      summary: `ه${args.action === "archive" ? "أرشف" : "فعّل"} الطالب ${student.name} (كود ${student.code}) — حالته دلوقتي ${row?.status ?? "ACTIVE"}.`,
      details: {
        الطالب: `${student.name} (${student.code})`,
        "الحالة الحالية": row?.status ?? "ACTIVE",
        "الحالة الجديدة": args.action === "archive" ? "ARCHIVED (مؤرشف)" : "ACTIVE (نشط)",
        ...(args.reason ? { السبب: args.reason } : {}),
      },
    };
  },
});

/* ============================================================
   TOOL: إعلان للطلاب — announcements.send (زي الـ API: أي موظف)
============================================================ */

register({
  name: "announcements.send",
  group: "communications",
  requiredModule: "communications",
  description: "ابعت إعلان/تنبيه لكل طلاب السنتر أو مجموعة معينة — بيوصلكم كإشعار في البورتال",
  usageHint: "«نبّه الكل إن بكرة إجازة» / «ابعت إعلان لمجموعة السبت إن الحصة الساعة 4»",
  input: z.object({
    title: z.string().min(3).max(120).describe("عنوان الإعلان"),
    body: z.string().min(3).max(600).describe("نص الإعلان"),
    group: z.string().max(80).optional().describe("اسم المجموعة — لو مش مكتوب يبقى للكل"),
  }),
  risk: "HIGH",
  permissionLabel: "إشعارات الطلاب",
  async handler(args, ctx): Promise<ToolOutput> {
    const { resolveAnnouncementAudience, sendPushToStudents } = await import("@/lib/push");
    let audienceType: "ALL" | "GROUP" = "ALL";
    let audienceId: string | null = null;
    let audienceName = "كل الطلاب";
    if (args.group?.trim()) {
      const groups = await db.group.findMany({
        where: { centerId: ctx.centerId, isActive: true, name: { contains: normalizeDigits(args.group.trim()) } },
        include: { subject: true, grade: true },
        take: 2,
      });
      if (groups.length === 0) throw new ToolError("NOT_FOUND", `مفيش مجموعة اسمها فيه «${args.group}».`);
      if (groups.length > 1) throw new ToolError("STATE", `«${args.group}» مطابقة أكتر من مجموعة — حدد الاسم أكتر (المادة أو المرحلة).`);
      audienceType = "GROUP";
      audienceId = groups[0].id;
      audienceName = `${groups[0].grade.name} — ${groups[0].subject.name} (${groups[0].name})`;
    }
    const audience = await resolveAnnouncementAudience(ctx.centerId, audienceType, audienceId);
    if (audience.error) throw new ToolError("STATE", audience.error);
    if (!audience.studentIds.length) throw new ToolError("STATE", "مفيش طلاب في الجمهور المحدد.");

    const announcement = await db.announcement.create({
      data: {
        centerId: ctx.centerId, title: args.title, body: args.body,
        audienceType, audienceId, audienceName,
        recipients: audience.studentIds.length,
        createdBy: ctx.user.id, createdByName: ctx.user.name,
      },
    });
    const CHUNK = 500;
    for (let i = 0; i < audience.studentIds.length; i += CHUNK) {
      await db.studentNotification.createMany({
        data: audience.studentIds.slice(i, i + CHUNK).map((studentId) => ({
          centerId: ctx.centerId, studentId, type: "ANNOUNCEMENT",
          title: args.title, body: args.body, announcementId: announcement.id,
        })),
      });
    }
    void sendPushToStudents(ctx.centerId, audience.studentIds, { title: args.title, body: args.body, url: "/portal", tag: `ann-${announcement.id}` }).catch(() => {});
    await logAudit({
      user: ctx.user, action: "إرسال إعلان", entity: "ANNOUNCEMENT", entityId: announcement.id,
      after: { title: args.title, audience: audienceName, recipients: audience.studentIds.length, via: "agent" },
    });
    return {
      summary: `بعت الإعلان «${args.title}» لـ ${audience.studentIds.length} طالب (${audienceName}).`,
      confirmSummary: `هبعث الإعلان «${args.title}» لـ ${audienceName} (${audience.studentIds.length} طالب).`,
      data: { announcementId: announcement.id, recipients: audience.studentIds.length, audienceName },
    };
  },
  async preview(args, ctx) {
    let audienceName = "كل الطلاب";
    let count: number | null = null;
    if (args.group?.trim()) {
      const groups = await db.group.findMany({
        where: { centerId: ctx.centerId, isActive: true, name: { contains: normalizeDigits(args.group.trim()) } },
        include: { subject: true, grade: true },
        take: 2,
      });
      if (groups.length === 0) throw new ToolError("NOT_FOUND", `مفيش مجموعة اسمها فيه «${args.group}».`);
      if (groups.length > 1) throw new ToolError("STATE", `«${args.group}» مطابقة أكتر من مجموعة — حدد أكتر.`);
      const regs = await db.studentGroup.count({ where: { groupId: groups[0].id, status: "ACTIVE" } });
      audienceName = `${groups[0].grade.name} — ${groups[0].subject.name} (${groups[0].name})`;
      count = regs;
    } else {
      count = await db.student.count({ where: { centerId: ctx.centerId, status: "ACTIVE" } });
    }
    return {
      summary: `هبعث الإعلان «${args.title}» لـ ${audienceName} (${count ?? 0} طالب).`,
      details: { العنوان: args.title, النص: args.body, الجمهور: audienceName, "عدد المستلمين": count ?? 0 },
    };
  },
});

/* ============================================================
   TOOLS: امتحانات — exams.list (قراءة) + سجل العمليات + الاشتراك
============================================================ */

register({
  name: "exams.list",
  group: "exams",
  requiredModule: "exams",
  description: "اعرض آخر الامتحانات/الكويزات مع حالة كل واحد (مسودة/شغال/خلص)",
  usageHint: "«إيه آخر الامتحانات؟» / «امتحانات مجموعة الرياضيات»",
  input: z.object({
    group: z.string().max(80).optional().describe("فلترة باسم المجموعة (اختياري)"),
  }),
  risk: "LOW",
  permissionLabel: "عرض الامتحانات",
  async handler(args, ctx): Promise<ToolOutput> {
    let groupId: string | undefined;
    if (args.group?.trim()) {
      const g = await db.group.findFirst({
        where: { centerId: ctx.centerId, isActive: true, name: { contains: normalizeDigits(args.group.trim()) } },
        select: { id: true, name: true },
      });
      if (!g) throw new ToolError("NOT_FOUND", `مفيش مجموعة اسمها فيه «${args.group}».`);
      groupId = g.id;
    }
    const rows = await db.exam.findMany({
      where: { centerId: ctx.centerId, ...(groupId ? { groupId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { group: { include: { subject: true, grade: true } } },
    });
    if (!rows.length) return { summary: "مفيش امتحانات مسجلة." + (groupId ? " في المجموعة دي." : ""), data: { count: 0 } };
    return {
      summary: `آخر ${rows.length} امتحان${groupId ? " في المجموعة" : ""}: ${rows.slice(0, 3).map((e) => e.title).join("، ")}.`,
      data: { count: rows.length, exams: rows.map((e) => ({ id: e.id, title: e.title, group: e.group?.name ?? null, status: e.status, startAt: e.startAt })) },
      cards: [{
        type: "students", title: "آخر الامتحانات",
        items: rows.map((e) => ({
          id: e.id,
          title: e.title,
          sub: `${e.group ? `${e.group.grade.name} — ${e.group.subject.name} (${e.group.name})` : "بدون مجموعة"} · ${e.status}${e.startAt ? ` · ${new Date(e.startAt).toLocaleDateString("ar-EG")}` : ""}`,
          actions: [{ label: "افتح الامتحانات", action: "navigate" as const, view: "exams" }],
        })),
      }],
    };
  },
});

register({
  name: "audit.recent",
  group: "reports",
  requiredModule: "reports",
  requiredRole: "MANAGER",
  description: "آخر العمليات اللي حصلت في السنتر (مين عمل إيه وامتى) — من سجل التدقيق",
  usageHint: "مين سجل آخر دفعة؟ / آخر العمليات — مدير السنتر بس",
  input: z.object({}),
  risk: "LOW",
  permissionLabel: "سجل العمليات (مدير)",
  async handler(args, ctx): Promise<ToolOutput> {
    requireManagerCtx(ctx);
    const rows = await db.auditLog.findMany({
      where: { centerId: ctx.centerId },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    if (!rows.length) return { summary: "سجل العمليات فاضي لسه.", data: { count: 0 } };
    return {
      summary: `آخر عملية: ${rows[0].userName} — ${rows[0].action}. وفيه ${rows.length} حركة في آخر السجل.`,
      data: { count: rows.length, logs: rows.map((l) => ({ who: l.userName, action: l.action, at: l.createdAt, reason: l.reason })) },
      cards: [{
        type: "students", title: "سجل العمليات (آخر 12)",
        items: rows.map((l) => ({
          id: l.id,
          title: `${l.userName} — ${l.action}`,
          sub: `${new Date(l.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}${l.reason ? ` · ${l.reason}` : ""}`,
        })),
      }],
    };
  },
});

register({
  name: "subscription.status",
  group: "dashboard",
  requiredRole: "MANAGER",
  description: "حالة اشتراك السنتر: الخطة، تجديد التاريخ، والأيام الباقية",
  usageHint: "«اشتراكنا لحد امتى؟» / «إيه خطتنا؟» — مدير السنتر بس",
  input: z.object({}),
  risk: "LOW",
  permissionLabel: "حالة الاشتراك (مدير)",
  async handler(args, ctx): Promise<ToolOutput> {
    requireManagerCtx(ctx);
    const sub = await getSubscriptionState(ctx.centerId);
    if (!sub.hasSubscription) {
      return { summary: "السنتر شغال من غير اشتراك مسجل (نظام قديم) — كله مفتوح.", data: sub as unknown as Record<string, unknown> };
    }
    const days = sub.daysLeft;
    const renewText = sub.renewalDate ?? "—";
    return {
      summary: `الخطة: ${sub.planName ?? "—"} — التجديد ${renewText}${typeof days === "number" ? ` (باقي ${days} يوم)` : ""}. الحالة: ${sub.effective}.`,
      data: sub as unknown as Record<string, unknown>,
      cards: [{
        type: "report", title: "اشتراك السنتر",
        rows: [
          { label: "الخطة", value: sub.planName ?? "—", tone: "info" },
          { label: "الحالة", value: sub.effective, tone: sub.effective === "ACTIVE" ? "good" : "warn" },
          { label: "التجديد", value: renewText },
          ...(typeof days === "number" ? [{ label: "الأيام الباقية", value: String(days), tone: days <= 10 ? "warn" as const : "good" as const }] : []),
        ],
      }],
    };
  },
});
