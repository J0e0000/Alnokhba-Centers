import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { normalizeDigits, toPiastres, todayStr } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/** GET /api/books — inventory + recent sales + quick stats
 *  ?report=sales&from=YYYY-MM-DD&to=YYYY-MM-DD — تقرير مبيعات ربحي */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);

  if (url.searchParams.get("report") === "sales") {
    return salesReport(user.centerId, url);
  }

  const [books, sales] = await Promise.all([
    db.book.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: {
        grade: { select: { name: true } },
        subject: { select: { name: true } },
        sales: { where: { date: todayStr() }, select: { qty: true, total: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.bookSale.findMany({
      where: { centerId: user.centerId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { book: { select: { name: true } } },
    }),
  ]);

  const today = todayStr();
  let soldTodayQty = 0;
  let soldTodayTotal = 0;
  for (const b of books) {
    for (const s of b.sales) { soldTodayQty += s.qty; soldTodayTotal += s.total; }
  }
  const inventoryValue = books.reduce((sum, b) => sum + b.price * b.stock, 0);
  // الحد البيسستو من إعدادات كل كتاب (reorderThreshold) — مش رقم ثابت
  const lowStockList = books
    .filter((b) => b.stock <= b.reorderThreshold)
    .map((b) => ({ id: b.id, name: b.name, stock: b.stock, threshold: b.reorderThreshold }));
  const lowStock = lowStockList.length;

  return ok({
    books: books.map((b) => {
      const soldQtyToday = b.sales.reduce((s, x) => s + x.qty, 0);
      const soldTotalToday = b.sales.reduce((s, x) => s + x.total, 0);
      const { sales, ...rest } = b;
      return {
        ...rest,
        grade: b.grade?.name ?? null,
        subject: b.subject?.name ?? null,
        soldQtyToday, soldTotalToday,
      };
    }),
    sales: sales.map((s) => ({
      id: s.id, book: s.book.name, buyerName: s.buyerName, qty: s.qty,
      unitPrice: s.unitPrice, total: s.total, method: s.method,
      date: s.date, createdAt: s.createdAt, note: s.note,
    })),
    stats: { soldTodayQty, soldTodayTotal, inventoryValue, lowStock, lowStockList, today },
  });
});

/** تقرير مبيعات الكتب: إيراد / تكلفة / ربح / الأكثر مبيعًا / قارب يخلص */
async function salesReport(centerId: string, url: URL) {
  const from = url.searchParams.get("from") ?? todayStr().slice(0, 8) + "01";
  const to = url.searchParams.get("to") ?? todayStr();

  const [sales, books] = await Promise.all([
    db.bookSale.findMany({
      where: { centerId, date: { gte: from, lte: to } },
      include: { book: { select: { name: true, costPrice: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.book.findMany({ where: { centerId, isActive: true } }),
  ]);

  let unitsSold = 0;
  let revenue = 0;
  let cost = 0;
  const perBook = new Map<string, { name: string; units: number; revenue: number; cost: number }>();
  for (const s of sales) {
    unitsSold += s.qty;
    revenue += s.total;
    // unitCost متسجّل وقت البيعة — لو قديمة (قبل الخاصية) نستخدم تكلفة الكتاب الحالية كتقدير
    const unitCost = s.unitCost > 0 ? s.unitCost : s.book.costPrice;
    const saleCost = unitCost * s.qty;
    cost += saleCost;
    const agg = perBook.get(s.bookId) ?? { name: s.book.name, units: 0, revenue: 0, cost: 0 };
    agg.units += s.qty; agg.revenue += s.total; agg.cost += saleCost;
    perBook.set(s.bookId, agg);
  }

  const topSelling = [...perBook.values()].sort((a, b) => b.units - a.units).slice(0, 10);
  const lowStock = books
    .filter((b) => b.stock <= b.reorderThreshold)
    .map((b) => ({ id: b.id, name: b.name, stock: b.stock, threshold: b.reorderThreshold }));

  return ok({
    report: {
      from, to,
      salesCount: sales.length,
      unitsSold, revenue, cost,
      grossProfit: revenue - cost,
      topSelling,
      lowStock,
    },
  });
}

// ============================= create / update book =============================

type BookBody = {
  id?: string;
  name?: string; gradeId?: string; subjectId?: string;
  price?: number; costPrice?: number; stock?: number; reorderThreshold?: number; notes?: string;
};

/** POST /api/books — add a book to inventory (manager) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<BookBody>(req);

  const name = normalizeDigits(String(body.name ?? "")).replace(/\s+/g, " ").trim();
  if (!name || name.length < 3) throw new ApiError("اكتب اسم الكتاب (3 حروف على الأقل).");

  const price = toPiastres(Number(body.price ?? 0));
  if (price <= 0) throw new ApiError("سعر الكتاب لازم يكون أكبر من صفر.");
  if (price > toPiastres(5000)) throw new ApiError("سعر الكتاب كبير بشكل غير منطقي — راجعه.");

  const stock = Math.trunc(Number(body.stock ?? 0));
  if (!Number.isFinite(stock) || stock < 0) throw new ApiError("الكمية لازم تكون رقم موجب.");
  if (stock > 9999) throw new ApiError("الكمية كبيرة بشكل غير منطقي — راجعها.");

  // سعر التكلفة (اختياري — للتقارير الربحية)
  let costPrice = 0;
  if (body.costPrice !== undefined && body.costPrice !== null && body.costPrice !== ("" as unknown)) {
    costPrice = toPiastres(Number(body.costPrice));
    if (costPrice < 0) throw new ApiError("سعر التكلفة مش ممكن يكون بالسالب.");
    if (costPrice > toPiastres(5000)) throw new ApiError("سعر التكلفة كبير بشكل غير منطقي.");
  }

  // حد إعادة الطلب — التنبيه لما المخزون يوصلله (افتراضي 3)
  let reorderThreshold = 3;
  if (body.reorderThreshold !== undefined && body.reorderThreshold !== null && body.reorderThreshold !== ("" as unknown)) {
    reorderThreshold = Math.trunc(Number(body.reorderThreshold));
    if (!Number.isFinite(reorderThreshold) || reorderThreshold < 0 || reorderThreshold > 999) {
      throw new ApiError("حد إعادة الطلب لازم يكون رقم من 0 لـ 999.");
    }
  }

  let gradeId: string | null = null;
  if (body.gradeId) {
    const g = await db.grade.findFirst({ where: { id: String(body.gradeId), centerId: user.centerId } });
    if (!g) throw new ApiError("المرحلة اللي اخترتها مش موجودة.");
    gradeId = g.id;
  }
  let subjectId: string | null = null;
  if (body.subjectId) {
    const s = await db.subject.findFirst({ where: { id: String(body.subjectId), centerId: user.centerId } });
    if (!s) throw new ApiError("المادة اللي اخترتها مش موجودة.");
    subjectId = s.id;
  }

  const exists = await db.book.findUnique({ where: { centerId_name: { centerId: user.centerId, name } } });
  if (exists && exists.isActive) throw new ApiError("في كتاب بنفس الاسم مسجل قبل كده.", 409);

  const book = await db.book.create({
    data: { centerId: user.centerId, name, gradeId, subjectId, price, costPrice, reorderThreshold, stock, notes: body.notes?.trim() || null },
  });

  await logAudit({
    user, action: AUDIT.BOOK_CREATED, entity: "BOOK", entityId: book.id,
    after: { name, price, stock },
  });
  return ok({ book: { id: book.id } }, { status: 201 });
});

/** PATCH /api/books — edit book (price/name/grade/subject/notes) or restock (manager) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<BookBody & { addStock?: number }>(req);

  const book = await db.book.findFirst({ where: { id: String(body.id ?? ""), centerId: user.centerId, isActive: true } });
  if (!book) throw new ApiError("الكتاب ده مش موجود.", 404);

  const data: Record<string, unknown> = {};
  let restockQty: number | null = null;

  if (body.name !== undefined) {
    const name = normalizeDigits(String(body.name)).replace(/\s+/g, " ").trim();
    if (!name || name.length < 3) throw new ApiError("اسم الكتاب قصير.");
    const dup = await db.book.findFirst({ where: { centerId: user.centerId, name, isActive: true, NOT: { id: book.id } } });
    if (dup) throw new ApiError("في كتاب تاني بنفس الاسم.", 409);
    data.name = name;
  }
  if (body.price !== undefined && body.price !== null && body.price !== ("" as unknown)) {
    const price = toPiastres(Number(body.price));
    if (price <= 0) throw new ApiError("السعر لازم يكون أكبر من صفر.");
    if (price > toPiastres(5000)) throw new ApiError("السعر كبير بشكل غير منطقي — راجعه.");
    data.price = price;
  }
  if (body.gradeId !== undefined) {
    if (!body.gradeId) data.gradeId = null;
    else {
      const g = await db.grade.findFirst({ where: { id: String(body.gradeId), centerId: user.centerId } });
      if (!g) throw new ApiError("المرحلة مش موجودة.");
      data.gradeId = g.id;
    }
  }
  if (body.subjectId !== undefined) {
    if (!body.subjectId) data.subjectId = null;
    else {
      const s = await db.subject.findFirst({ where: { id: String(body.subjectId), centerId: user.centerId } });
      if (!s) throw new ApiError("المادة مش موجودة.");
      data.subjectId = s.id;
    }
  }
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
  if (body.costPrice !== undefined && body.costPrice !== null && body.costPrice !== ("" as unknown)) {
    const costPrice = toPiastres(Number(body.costPrice));
    if (costPrice < 0) throw new ApiError("سعر التكلفة مش ممكن يكون بالسالب.");
    data.costPrice = costPrice;
  }
  if (body.reorderThreshold !== undefined && body.reorderThreshold !== null && body.reorderThreshold !== ("" as unknown)) {
    const rt = Math.trunc(Number(body.reorderThreshold));
    if (!Number.isFinite(rt) || rt < 0 || rt > 999) throw new ApiError("حد إعادة الطلب لازم يكون رقم من 0 لـ 999.");
    data.reorderThreshold = rt;
  }
  if (body.addStock !== undefined && body.addStock !== null && body.addStock !== ("" as unknown)) {
    const add = Math.trunc(Number(body.addStock));
    if (!Number.isFinite(add) || add === 0) throw new ApiError("كمية التوريد لازم تكون رقم غير صفر.");
    const next = book.stock + add;
    if (next < 0) throw new ApiError(`الكمية دي هتخلي المخزون بالسالب — المتاح حالياً ${book.stock}.`);
    if (next > 99999) throw new ApiError("الكمية كلها كبيرة بشكل غير منطقي.");
    data.stock = next;
    restockQty = add;
  }

  if (Object.keys(data).length === 0) throw new ApiError("مفيش أي تغيير اتبعت.");

  const updated = await db.book.update({ where: { id: book.id }, data: data as never });

  await logAudit({
    user,
    action: restockQty !== null ? AUDIT.BOOK_RESTOCKED : AUDIT.BOOK_UPDATED,
    entity: "BOOK", entityId: book.id,
    before: restockQty !== null ? { stock: book.stock } : { name: book.name, price: book.price },
    after: restockQty !== null ? { stock: updated.stock, added: restockQty } : data,
  });
  return ok({ book: { id: updated.id, stock: updated.stock } });
});

/** DELETE /api/books?id= — soft delete (manager); blocked if book has sales history */
export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const book = await db.book.findFirst({ where: { id, centerId: user.centerId, isActive: true } });
  if (!book) throw new ApiError("الكتاب ده مش موجود.", 404);

  const soldCount = await db.bookSale.count({ where: { bookId: book.id } });
  if (soldCount > 0) {
    // keep history intact — just archive the book off the shelf
    await db.book.update({ where: { id }, data: { isActive: false, stock: 0 } });
    await logAudit({ user, action: AUDIT.BOOK_DELETED, entity: "BOOK", entityId: id, after: { name: book.name, archived: true, salesKept: soldCount } });
    return ok({ ok: true, archived: true });
  }

  await db.book.delete({ where: { id } });
  await logAudit({ user, action: AUDIT.BOOK_DELETED, entity: "BOOK", entityId: id, after: { name: book.name } });
  return ok({ ok: true });
});

// ============================= sell =============================

type SaleBody = {
  bookId?: string; qty?: number;
  studentId?: string; buyerName?: string;
  method?: string; note?: string;
  idemKey?: string; // مفتاح idempotency — الضغط المزدوج يرجّع نفس البيعة
};

/** PUT /api/books — record a sale: stock decrement + ledger entry + journal (any center user)
 *  idemKey: لو نفس المفتاح اتبعت قبل كده، ترجّع نفس البيعة من غير ما تخصم مخزون تاني */
export const PUT = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<SaleBody>(req);

  // ---- idempotency: نفس المفتاح = نفس البيعة ----
  const idemKey = body.idemKey?.trim() || null;
  if (idemKey) {
    const existing = await db.bookSale.findUnique({ where: { idemKey } });
    if (existing && existing.centerId === user.centerId) {
      const bookAfter = await db.book.findUnique({ where: { id: existing.bookId } });
      return ok({
        sale: { id: existing.id, total: existing.total, qty: existing.qty, remainingStock: bookAfter?.stock ?? 0 },
        duplicate: true,
        message: "البيعة دي اتسجلت قبل كده — مفيش خصم تاني.",
      });
    }
  }

  const book = await db.book.findFirst({ where: { id: String(body.bookId ?? ""), centerId: user.centerId, isActive: true } });
  if (!book) throw new ApiError("الكتاب ده مش موجود.", 404);

  const qty = Math.trunc(Number(body.qty ?? 1));
  if (!Number.isFinite(qty) || qty <= 0) throw new ApiError("الكمية لازم تكون رقم أكبر من صفر.");
  if (qty > 999) throw new ApiError("الكمية كبيرة بشكل غير منطقي.");
  if (qty > book.stock) throw new ApiError(`المتاح من الكتاب ده ${book.stock} بس — راجع الكمية.`);

  const method = ["CASH", "VODAFONE", "INSTAPAY"].includes(body.method ?? "") ? body.method! : "CASH";

  let studentId: string | null = null;
  let buyerName: string | null = normalizeDigits(String(body.buyerName ?? "")).trim() || null;

  if (body.studentId) {
    const st = await db.student.findFirst({ where: { id: String(body.studentId), centerId: user.centerId } });
    if (!st) throw new ApiError("الطالب ده مش موجود.", 404);
    studentId = st.id;
    buyerName = st.name;
  }
  if (!studentId && !buyerName) throw new ApiError("اختار الطالب المشتري أو اكتب اسم الزبون.");

  const total = book.price * qty;
  const date = todayStr();

  const sale = await db.$transaction(async (tx) => {
    // atomic stock guard inside the transaction
    const fresh = await tx.book.findUnique({ where: { id: book.id } });
    if (!fresh || !fresh.isActive || fresh.stock < qty) {
      throw new ApiError(`المتاح من الكتاب ده ${fresh?.stock ?? 0} بس — راجع الكمية.`, 409);
    }
    await tx.book.update({ where: { id: book.id }, data: { stock: fresh.stock - qty } });

    const s = await tx.bookSale.create({
      data: {
        centerId: user.centerId, bookId: book.id, studentId, buyerName,
        qty, unitPrice: book.price, unitCost: fresh.costPrice, total, method, date,
        idemKey,
        note: body.note?.trim() || null,
        createdBy: user.id,
      },
    });

    // journal entry so book revenue shows up in accounting
    await tx.centerTransaction.create({
      data: {
        centerId: user.centerId,
        type: "BOOK_SALE",
        amount: total,
        date,
        note: `بيع ${qty}× ${book.name}${buyerName ? ` — ${buyerName}` : ""}`,
        refType: "BOOK_SALE",
        refId: s.id,
        createdBy: user.id,
      },
    });
    return s;
  });

  await logAudit({
    user, action: AUDIT.BOOK_SOLD, entity: "BOOK_SALE", entityId: sale.id,
    after: { book: book.name, qty, total, buyer: buyerName, method },
  });

  return ok({
    sale: { id: sale.id, total, qty, remainingStock: book.stock - qty },
    message: `تم بيع ${qty} × ${book.name} بـ ${(total / 100).toLocaleString("en-EG")} جنيه — باقي ${book.stock - qty} نسخة.`,
  }, { status: 201 });
});
