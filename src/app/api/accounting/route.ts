import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toPiastres, todayStr } from "@/lib/normalize";
import { expectedCash } from "@/lib/finance";

export const dynamic = "force-dynamic";

/** GET /api/accounting?section=expenses|cash|settlements|journal */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const section = new URL(req.url).searchParams.get("section") ?? "all";
  const today = todayStr();

  let expensesData: Record<string, unknown> | undefined;
  if (section === "expenses" || section === "all") {
    const expenses = await db.expense.findMany({
      where: { centerId: user.centerId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const monthStart = today.slice(0, 8) + "01";
    const monthTotal = await db.expense.aggregate({ _sum: { amount: true }, where: { centerId: user.centerId, date: { gte: monthStart, lte: today } } });
    if (section === "expenses") {
      return ok({ expenses, monthTotal: monthTotal._sum.amount ?? 0 });
    }
    expensesData = { expenses, monthTotal: monthTotal._sum.amount ?? 0 };
  }

  let cashData: Record<string, unknown> | undefined;
  if (section === "cash" || section === "all") {
    const cash = await expectedCash(user.centerId, today);
    const movements = await db.studentTransaction.findMany({
      where: { centerId: user.centerId, createdAt: { gte: new Date(`${today}T00:00:00.000Z`), lte: new Date(`${today}T23:59:59.999Z`) }, type: { in: ["PAYMENT", "REFUND"] } },
      orderBy: { createdAt: "desc" }, take: 40,
      include: { student: { select: { name: true, code: true } } },
    });
    if (section === "cash") {
      return ok({ ...cash, movements });
    }
    cashData = { ...cash, movements };
  }

  let settlementsData: Record<string, unknown> | undefined;
  if (section === "settlements" || section === "all") {
    const teachers = await db.teacher.findMany({ where: { centerId: user.centerId }, orderBy: { name: "asc" } });
    const grouped = await db.teacherSettlement.groupBy({
      by: ["teacherId"],
      _sum: { amount: true },
      where: { centerId: user.centerId },
    });
    const recent = await db.teacherSettlement.findMany({
      where: { centerId: user.centerId },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const settlements = teachers.map((t) => {
      const g = grouped.find((x) => x.teacherId === t.id);
      return {
        teacherId: t.id, name: t.name, phone: t.phone,
        earned: 0, paid: 0, payable: g?._sum.amount ?? 0,
      };
    });
    if (section === "settlements") {
      return ok({ settlements, recent });
    }
    settlementsData = { settlements, recent };
  }

  let journalData: Record<string, unknown> | undefined;
  if (section === "journal" || section === "all") {
    const journal = await db.centerTransaction.findMany({
      where: { centerId: user.centerId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    if (section === "journal") return ok({ journal });
    journalData = { journal };
  }

  return ok({ ...(expensesData ?? {}), ...(cashData ?? {}), ...(settlementsData ?? {}), ...(journalData ?? {}) });
});

type ActionBody = {
  action?: "add-expense" | "open-day" | "close-day" | "pay-teacher";
  // expense
  category?: string; amount?: number; date?: string; note?: string;
  // cash
  openingCash?: number; countedCash?: number;
  // teacher payout
  teacherId?: string;
};

/** POST /api/accounting — manager actions */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<ActionBody>(req);
  const today = todayStr();

  if (body.action === "add-expense") {
    const amount = toPiastres(Number(body.amount ?? 0));
    if (amount <= 0) throw new ApiError("قيمة المصروف لازم تكون أكبر من صفر.");
    if (amount > toPiastres(500000)) throw new ApiError("المبلغ ده كبير بشكل غير منطقي — راجعه تاني.");
    const categories = ["RENT", "ELECTRICITY", "SALARIES", "MAINTENANCE", "SUPPLIES", "OTHER"];
    const category = categories.includes(body.category ?? "") ? body.category! : "OTHER";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date! : today;

    const expense = await db.expense.create({
      data: { centerId: user.centerId, category, amount, date, note: body.note?.trim() || null, createdBy: user.id },
    });
    await db.centerTransaction.create({
      data: { centerId: user.centerId, type: "EXPENSE", amount: -amount, date, note: body.note?.trim() || category, refType: "EXPENSE", refId: expense.id, createdBy: user.id },
    });
    await logAudit({ user, action: AUDIT.EXPENSE_ADDED, entity: "EXPENSE", entityId: expense.id, after: { category, amount, date } });
    return ok({ expense: { id: expense.id } }, { status: 201 });
  }

  if (body.action === "open-day") {
    const opening = toPiastres(Number(body.openingCash ?? 0));
    if (opening < 0) throw new ApiError("رصيد الصندوق الافتتاحي مينفعش يكون بالسالب.");
    const existing = await db.cashDay.findUnique({ where: { centerId_date: { centerId: user.centerId, date: today } } });
    if (existing?.status === "CLOSED") throw new ApiError("اليوم ده مقفول خلاص — مينفعش تفتحه تاني.");
    const cashDay = await db.cashDay.upsert({
      where: { centerId_date: { centerId: user.centerId, date: today } },
      create: { centerId: user.centerId, date: today, openingCash: opening, openedBy: user.id },
      update: { openingCash: opening },
    });
    await logAudit({ user, action: AUDIT.CASH_OPENED, entity: "CASH_DAY", entityId: cashDay.id, after: { openingCash: opening } });
    return ok({ cashDay: { id: cashDay.id } });
  }

  if (body.action === "close-day") {
    const counted = toPiastres(Number(body.countedCash ?? 0));
    if (counted < 0) throw new ApiError("المبلغ المعدود في الصندوق مينفعش يكون بالسالب.");
    const existing = await db.cashDay.findUnique({ where: { centerId_date: { centerId: user.centerId, date: today } } });
    if (!existing) throw new ApiError("افتح الصندوق الأول بتحديد الرصيد الافتتاحي.");
    if (existing.status === "CLOSED") throw new ApiError("اليوم ده مقفول خلاص.");
    const exp = await expectedCash(user.centerId, today);
    await db.cashDay.update({
      where: { id: existing.id },
      data: { countedCash: counted, status: "CLOSED", closedBy: user.id, closedAt: new Date() },
    });
    const difference = counted - exp.expected;
    await logAudit({
      user, action: AUDIT.CASH_CLOSED, entity: "CASH_DAY", entityId: existing.id,
      after: { countedCash: counted, expected: exp.expected, difference },
    });
    return ok({ counted, expected: exp.expected, difference });
  }

  if (body.action === "pay-teacher") {
    const teacher = await db.teacher.findFirst({ where: { id: String(body.teacherId ?? ""), centerId: user.centerId } });
    if (!teacher) throw new ApiError("المدرس ده مش موجود.", 404);
    const amount = toPiastres(Number(body.amount ?? 0));
    if (amount <= 0) throw new ApiError("مبلغ الصرف لازم يكون أكبر من صفر.");

    const grouped = await db.teacherSettlement.aggregate({
      _sum: { amount: true }, where: { centerId: user.centerId, teacherId: teacher.id },
    });
    const payable = grouped._sum.amount ?? 0;
    if (amount > payable + toPiastres(1)) {
      throw new ApiError(`المبلغ أكبر من مستحقات المدرس (${(payable / 100).toLocaleString("en-EG")} جنيه).`);
    }

    const settlement = await db.teacherSettlement.create({
      data: { centerId: user.centerId, teacherId: teacher.id, type: "PAID", amount: -amount, date: today, note: body.note?.trim() || "صرف مستحقات", createdBy: user.id },
    });
    await db.centerTransaction.create({
      data: { centerId: user.centerId, type: "TEACHER_PAYOUT", amount: -amount, date: today, note: `صرف لمدرس: ${teacher.name}`, refType: "TEACHER", refId: teacher.id, createdBy: user.id },
    });
    await logAudit({ user, action: AUDIT.TEACHER_PAID, entity: "TEACHER_SETTLEMENT", entityId: settlement.id, after: { teacher: teacher.name, amount } });
    return ok({ settlement: { id: settlement.id }, remaining: payable - amount });
  }

  throw new ApiError("العملية دي مش معروفة.");
});
