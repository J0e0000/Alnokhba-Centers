"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen, BookPlus, ShoppingCart, PackagePlus, Pencil, Trash2, Search,
  Minus, Plus, Loader2, X, Store, TrendingUp, PackageOpen, AlertTriangle, BarChart3, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, PAY_METHOD_LABEL, todayStr, type SessionUser } from "./lib";
import { PageHeader, MoneyStat, Stat, SectionCard, EmptyState, Loading } from "./shared";
import { StudentSearchBar } from "./student-search";
import { useAcademics, Field, inputCls } from "./students";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type BookRow = {
  id: string; name: string; price: number; stock: number; notes: string | null;
  gradeId: string | null; subjectId: string | null;
  grade: string | null; subject: string | null;
  costPrice: number; reorderThreshold: number;
  soldQtyToday: number; soldTotalToday: number;
};

type SaleRow = {
  id: string; book: string; buyerName: string | null; qty: number;
  unitPrice: number; total: number; method: string | null;
  date: string; createdAt: string; note: string | null;
};

type BooksData = {
  books: BookRow[];
  sales: SaleRow[];
  stats: {
    soldTodayQty: number; soldTodayTotal: number; inventoryValue: number;
    lowStock: number; lowStockList: { id: string; name: string; stock: number; threshold: number }[];
    today: string;
  };
};

type SalesReport = {
  from: string; to: string; salesCount: number;
  unitsSold: number; revenue: number; cost: number; grossProfit: number;
  topSelling: { name: string; units: number; revenue: number; cost: number }[];
  lowStock: { id: string; name: string; stock: number; threshold: number }[];
};

export function BooksView({ user }: { user: SessionUser }) {
  const [data, setData] = useState<BooksData | null>(null);
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [sellBook, setSellBook] = useState<BookRow | null>(null);
  const [editBook, setEditBook] = useState<BookRow | null>(null);
  const [restockBook, setRestockBook] = useState<BookRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BookRow | null>(null);
  const [showReport, setShowReport] = useState(false);

  const isManager = user.role === "MANAGER";

  const load = useCallback(() => {
    api<BooksData>("/api/books").then(setData).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const filtered = useMemo(() => {
    const raw = q.trim();
    if (!raw || !data) return data?.books ?? [];
    return data.books.filter((b) =>
      b.name.includes(raw) || (b.grade ?? "").includes(raw) || (b.subject ?? "").includes(raw)
    );
  }, [data, q]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="الكتب"
        subtitle="المخزون والمبيعات — كل عملية بيع بتتسجل وبتدخل في حسابات السنتر"
        action={isManager ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReport((v) => !v)}
              className="border border-border bg-card text-foreground font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98]"
            >
              <BarChart3 className="w-4.5 h-4.5" /> تقرير المبيعات
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98]"
            >
              <BookPlus className="w-4.5 h-4.5" /> إضافة كتاب
            </button>
          </div>
        ) : undefined}
      />

      {/* ===== Stats ===== */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="اتبايع النهاردة"
            value={<>{data.stats.soldTodayQty} <span className="text-xs font-bold opacity-70">نسخة</span></>}
            hint={<>{fmt(data.stats.soldTodayTotal)} جنيه</>}
            tone="brand"
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <MoneyStat label="قيمة المخزون" piastres={data.stats.inventoryValue} hint="بالسعر الحالي" icon={<Store className="w-4 h-4" />} />
          <Stat label="عدد الكتب" value={data.books.length} hint="على الرف" icon={<BookOpen className="w-4 h-4" />} />
          <Stat
            label="قرب يخلص"
            value={data.stats.lowStock}
            hint="كتاب وصل حد إعادة الطلب"
            tone={data.stats.lowStock > 0 ? "warning" : "default"}
            icon={<AlertTriangle className="w-4 h-4" />}
          />
        </div>
      )}

      {/* تنبيه بارز لما كتاب يوصل حد إعادة الطلب */}
      {data && data.stats.lowStockList && data.stats.lowStockList.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" role="alert">
          <div className="flex items-center gap-2.5 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm font-extrabold text-amber-800">
              {data.stats.lowStockList.length === 1 ? "كتاب قرب يخلص — زوّد مخزونه" : `${data.stats.lowStockList.length} كتب قربت تخلص — زوّد مخزونها`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.stats.lowStockList.map((b) => (
              <span key={b.id} className="text-xs font-bold bg-card border border-amber-200 rounded-full px-2.5 py-1">
                {b.name} <span className="nk-num text-amber-700 dark:text-amber-300" dir="ltr">({b.stock}/{b.threshold})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {showReport && <SalesReportCard />}

      {/* ===== Search ===== */}
      <div className="relative">
        <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground" />
        <input
          placeholder="ابحث في الكتب... (اسم / مرحلة / مادة)"
          className="w-full h-12 rounded-2xl border border-input bg-card ps-10 pe-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* ===== Inventory table ===== */}
      {!data ? (
        <Loading label="جاري تحميل المخزون..." />
      ) : filtered.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<PackageOpen className="w-8 h-8" />}
            title={data.books.length === 0 ? "مفيش كتب مسجلة لسه" : "مفيش كتاب بالبحث ده"}
            hint={data.books.length === 0
              ? (isManager ? 'دوس على "إضافة كتاب" وسجّل أول كتاب عندك على الرف.' : "المدير لسه مسجّلش كتب — أول ما يضيفها هتظهر هنا.")
              : `مفيش نتيجة لـ "${q}"`}
          />
        </div>
      ) : (
        <SectionCard title="المخزون" icon={<BookOpen className="w-4 h-4" />}>
          <div className="overflow-x-auto nk-scroll -mx-1 px-1">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground border-b bg-muted/40">
                  <th className="text-start font-bold px-3 py-2.5 rounded-s-xl">الكتاب</th>
                  <th className="text-start font-bold px-3 py-2.5">المرحلة</th>
                  <th className="text-start font-bold px-3 py-2.5">السعر</th>
                  <th className="text-start font-bold px-3 py-2.5">المتاح</th>
                  <th className="text-start font-bold px-3 py-2.5">النهاردة</th>
                  <th className="text-start font-bold px-3 py-2.5 rounded-e-xl">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30 transition">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-9 h-9 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center shrink-0">
                          <BookOpen className="w-4.5 h-4.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-extrabold truncate max-w-[220px]">{b.name}</p>
                          {b.subject && <p className="text-[11px] text-muted-foreground font-semibold">{b.subject}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-muted-foreground">{b.grade ?? "—"}</td>
                    <td className="px-3 py-3 font-extrabold nk-num" dir="ltr">{fmt(b.price)} ج</td>
                    <td className="px-3 py-3">
                      <span className={cn(
                        "nk-num font-extrabold rounded-lg px-2.5 py-1 border",
                        b.stock === 0 ? "bg-rose-50 text-rose-700 border-rose-200"
                        : b.stock <= b.reorderThreshold ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      )}>
                        {b.stock}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {b.soldQtyToday > 0 ? (
                        <span className="text-xs font-bold nk-num" dir="ltr">{b.soldQtyToday} × · {fmt(b.soldTotalToday)} ج</span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-semibold">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSellBook(b)}
                          disabled={b.stock === 0}
                          className="nk-brand-bg text-white text-xs font-extrabold rounded-lg px-3 py-1.5 flex items-center gap-1 active:scale-95 disabled:opacity-40"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" /> بيع
                        </button>
                        {isManager && (
                          <>
                            <button onClick={() => setRestockBook(b)} title="توريد نسخ" className="rounded-lg border border-border bg-card p-1.5 hover:bg-muted/60 transition">
                              <PackagePlus className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <button onClick={() => setEditBook(b)} title="تعديل" className="rounded-lg border border-border bg-card p-1.5 hover:bg-muted/60 transition">
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <button onClick={() => setConfirmDelete(b)} title="حذف" className="rounded-lg border border-border bg-card p-1.5 hover:bg-rose-50 transition">
                              <Trash2 className="w-4 h-4 text-rose-500" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ===== Recent sales ===== */}
      {data && (
        <SectionCard title="آخر المبيعات" icon={<ShoppingCart className="w-4 h-4" />}>
          {data.sales.length === 0 ? (
            <EmptyState title="لسه مفيش مبيعات" hint="أول ما تبيع كتاب هيظهر هنا." />
          ) : (
            <div className="overflow-x-auto nk-scroll -mx-1 px-1">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-start text-xs text-muted-foreground border-b bg-muted/40">
                    <th className="text-start font-bold px-3 py-2.5 rounded-s-xl">الكتاب</th>
                    <th className="text-start font-bold px-3 py-2.5">المشتري</th>
                    <th className="text-start font-bold px-3 py-2.5">الكمية</th>
                    <th className="text-start font-bold px-3 py-2.5">الإجمالي</th>
                    <th className="text-start font-bold px-3 py-2.5 rounded-e-xl">الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sales.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-3 py-2.5 font-extrabold">
                        {s.book}
                        <span className="block text-[10px] text-muted-foreground font-bold">{PAY_METHOD_LABEL[s.method ?? "CASH"] ?? s.method}</span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-xs">{s.buyerName ?? "—"}</td>
                      <td className="px-3 py-2.5 nk-num font-bold" dir="ltr">{s.qty}×</td>
                      <td className="px-3 py-2.5 font-extrabold text-emerald-700 dark:text-emerald-300 nk-num" dir="ltr">{fmt(s.total)} ج</td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground font-bold">
                        {s.date === data.stats.today ? "النهاردة" : s.date}
                        {" · "}
                        {new Date(s.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ===== Dialogs ===== */}
      <SellBookDialog
        book={sellBook}
        onClose={() => setSellBook(null)}
        onDone={() => { setSellBook(null); setReloadKey((k) => k + 1); }}
      />

      <BookFormDialog
        open={showAdd || !!editBook}
        editing={editBook}
        onClose={() => { setShowAdd(false); setEditBook(null); }}
        onSaved={() => { setShowAdd(false); setEditBook(null); setReloadKey((k) => k + 1); }}
      />

      <RestockDialog
        book={restockBook}
        onClose={() => setRestockBook(null)}
        onDone={() => { setRestockBook(null); setReloadKey((k) => k + 1); }}
      />

      <DeleteBookDialog
        book={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onDone={() => { setConfirmDelete(null); setReloadKey((k) => k + 1); }}
      />
    </div>
  );
}

// =====================================================================
// Sell dialog

function SellBookDialog({ book, onClose, onDone }: {
  book: BookRow | null; onClose: () => void; onDone: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [mode, setMode] = useState<"student" | "walkin">("student");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [walkinName, setWalkinName] = useState("");
  const [method, setMethod] = useState("CASH");
  const [buyerQuery, setBuyerQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState("");

  useEffect(() => {
    if (book) { setQty(1); setMode("student"); setPicked(null); setWalkinName(""); setMethod("CASH"); setBuyerQuery("");
      // مفتاح idempotency جديد لكل بيعة — يحمي من الضغط المزدوج
      setIdemKey(`sale-${book.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`); }
  }, [book]);

  if (!book) return null;
  const bk = book;

  const total = book.price * qty;

  async function sell() {
    if (mode === "student" && !picked) { toast.error("اختار الطالب المشتري من البحث."); return; }
    if (mode === "walkin" && !walkinName.trim()) { toast.error("اكتب اسم الزبون."); return; }
    setBusy(true);
    try {
      const res = await api<{ message: string; duplicate?: boolean }>("/api/books", {
        method: "PUT",
        body: {
          bookId: bk.id, qty, method, idemKey,
          studentId: mode === "student" ? picked!.id : undefined,
          buyerName: mode === "walkin" ? walkinName.trim() : undefined,
        },
      });
      if (res.duplicate) toast.info(res.message);
      else toast.success(res.message);
      onDone();
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!book} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 nk-brand-text" /> بيع كتاب
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* book line */}
          <div className="rounded-2xl border bg-muted/40 px-3.5 py-3 flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-sm truncate">{book.name}</p>
              <p className="text-xs text-muted-foreground font-bold nk-num" dir="ltr">{fmt(book.price)} ج · متاح {book.stock}</p>
            </div>
          </div>

          {/* qty stepper */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold">الكمية</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} className="w-10 h-10 rounded-xl border-2 border-input bg-card grid place-items-center active:scale-95 transition">
                <Minus className="w-4 h-4" />
              </button>
              <span className="nk-num w-14 text-center font-extrabold text-xl">{qty}</span>
              <button type="button" onClick={() => setQty((n) => Math.min(book.stock, n + 1))} className="w-10 h-10 rounded-xl border-2 border-input bg-card grid place-items-center active:scale-95 transition">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* buyer */}
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setMode("student"); setWalkinName(""); }}
                className={cn("flex-1 rounded-xl border-2 py-2 text-sm font-extrabold transition", mode === "student" ? "border-transparent nk-brand-bg-soft ring-2 ring-[var(--c-primary)]" : "border-input bg-card text-muted-foreground")}>
                طالب مسجل
              </button>
              <button type="button" onClick={() => { setMode("walkin"); setPicked(null); setBuyerQuery(""); }}
                className={cn("flex-1 rounded-xl border-2 py-2 text-sm font-extrabold transition", mode === "walkin" ? "border-transparent nk-brand-bg-soft ring-2 ring-[var(--c-primary)]" : "border-input bg-card text-muted-foreground")}>
                زبون خارجي
              </button>
            </div>

            {mode === "student" ? (
              picked ? (
                <div className="flex items-center gap-2 rounded-xl border-2 border-transparent nk-brand-bg-soft ring-2 ring-[var(--c-primary)] px-3 py-2.5">
                  <span className="w-8 h-8 rounded-lg nk-brand-bg text-white grid place-items-center font-extrabold text-sm shrink-0">{picked.name.trim()[0]}</span>
                  <p className="flex-1 font-extrabold text-sm truncate">{picked.name}</p>
                  <button type="button" onClick={() => { setPicked(null); setBuyerQuery(""); }} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <StudentSearchBar
                  value={buyerQuery}
                  onChange={setBuyerQuery}
                  onPick={(s) => setPicked({ id: s.id, name: s.name })}
                  placeholder="ابحث عن الطالب المشتري بالاسم أو الكود..."
                />
              )
            ) : (
              <input
                className={inputCls(false)}
                placeholder="اسم الزبون (مش طالب عندنا)"
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value)}
              />
            )}
          </div>

          {/* method */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold">طريقة الدفع</span>
            <div className="flex gap-1.5">
              {["CASH", "VODAFONE", "INSTAPAY"].map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-extrabold transition",
                    method === m ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground"
                  )}>
                  {PAY_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* total + confirm */}
          <div className="rounded-2xl nk-brand-grad text-white px-4 py-3 flex items-center justify-between">
            <span className="font-bold text-sm">الإجمالي ({qty} × {fmt(book.price)} ج)</span>
            <span className="font-extrabold text-xl nk-num" dir="ltr">{fmt(total)} ج</span>
          </div>

          <div className="flex gap-2">
            <button onClick={sell} disabled={busy || book.stock === 0}
              className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
              تأكيد البيع
            </button>
            <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Add / edit book dialog (manager)

function BookFormDialog({ open, editing, onClose, onSaved }: {
  open: boolean; editing: BookRow | null; onClose: () => void; onSaved: () => void;
}) {
  const academics = useAcademics();
  const [form, setForm] = useState({ name: "", gradeId: "", subjectId: "", price: "", costPrice: "", stock: "", reorderThreshold: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? "",
        gradeId: editing?.gradeId ?? "",
        subjectId: editing?.subjectId ?? "",
        price: editing ? String(editing.price / 100) : "",
        costPrice: editing && editing.costPrice > 0 ? String(editing.costPrice / 100) : "",
        stock: editing ? String(editing.stock) : "",
        reorderThreshold: editing ? String(editing.reorderThreshold) : "3",
        notes: editing?.notes ?? "",
      });
    }
  }, [open, editing]);

  async function save() {
    const name = form.name.trim();
    if (!name || name.length < 3) { toast.error("اكتب اسم الكتاب (3 حروف على الأقل)."); return; }
    const priceNum = parseFloat(form.price);
    if (!isFinite(priceNum) || priceNum <= 0) { toast.error("اكتب سعر الكتاب صح."); return; }
    const stockNum = form.stock.trim() === "" ? 0 : parseInt(form.stock, 10);
    if (!Number.isFinite(stockNum) || stockNum < 0) { toast.error("الكمية لازم تكون رقم موجب."); return; }

    setBusy(true);
    try {
      if (editing) {
        await api("/api/books", {
          method: "PATCH",
          body: {
            id: editing.id, name,
            gradeId: form.gradeId || null,
            subjectId: form.subjectId || null,
            price: priceNum,
            costPrice: form.costPrice.trim() === "" ? 0 : parseFloat(form.costPrice) || 0,
            reorderThreshold: form.reorderThreshold.trim() === "" ? 3 : parseInt(form.reorderThreshold, 10) || 3,
            notes: form.notes,
          },
        });
        toast.success("تم تعديل الكتاب.");
      } else {
        await api("/api/books", {
          method: "POST",
          body: {
            name,
            gradeId: form.gradeId || null,
            subjectId: form.subjectId || null,
            price: priceNum,
            costPrice: form.costPrice.trim() === "" ? 0 : parseFloat(form.costPrice) || 0,
            stock: stockNum,
            reorderThreshold: form.reorderThreshold.trim() === "" ? 3 : parseInt(form.reorderThreshold, 10) || 3,
            notes: form.notes,
          },
        });
        toast.success("تم إضافة الكتاب للمخزون.");
      }
      onSaved();
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookPlus className="w-5 h-5 nk-brand-text" />
            {editing ? "تعديل كتاب" : "إضافة كتاب جديد"}
          </DialogTitle>
        </DialogHeader>

        {!academics ? <Loading label="جاري التحميل..." /> : (
          <div className="space-y-3.5">
            <Field label="اسم الكتاب" required>
              <input className={inputCls(false)} value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="كتاب الفيزياء — الأول الثانوي" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="المرحلة (اختياري)">
                <select className={inputCls(false)} value={form.gradeId} onChange={(e) => setForm((f) => ({ ...f, gradeId: e.target.value }))}>
                  <option value="">بدون مرحلة</option>
                  {academics.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
              <Field label="المادة (اختياري)">
                <select className={inputCls(false)} value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}>
                  <option value="">بدون مادة</option>
                  {academics.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="سعر البيع (جنيه)" required>
                <input dir="ltr" inputMode="decimal" className={inputCls(false)} value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.replace(/[^\d.]/g, "") }))}
                  placeholder="150" />
              </Field>
              <Field label="سعر التكلفة (جنيه) — اختياري">
                <input dir="ltr" inputMode="decimal" className={inputCls(false)} value={form.costPrice}
                  onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value.replace(/[^\d.]/g, "") }))}
                  placeholder="100 — للتقارير الربحية" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {!editing && (
                <Field label="الكمية على الرف">
                  <input dir="ltr" inputMode="numeric" className={inputCls(false)} value={form.stock}
                    onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value.replace(/[^\d]/g, "") }))}
                    placeholder="20" />
                </Field>
              )}
              <Field label="حد إعادة الطلب">
                <input dir="ltr" inputMode="numeric" className={inputCls(false)} value={form.reorderThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, reorderThreshold: e.target.value.replace(/[^\d]/g, "") }))}
                  placeholder="3 — التنبيه لما المخزون يوصل الرقم ده" />
              </Field>
            </div>

            <Field label="ملاحظات (اختياري)">
              <input className={inputCls(false)} value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="الطبعة الجديدة — مطبعة النخبة" />
            </Field>

            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={busy}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
                {editing ? "حفظ التعديل" : "إضافة الكتاب"}
              </button>
              <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// تقرير مبيعات الكتب (إيراد / تكلفة / ربح إجمالي / الأكثر مبيعًا)

function SalesReportCard() {
  const monthStart = todayStr().slice(0, 8) + "01";
  const today = todayStr();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await api<{ report: SalesReport }>(`/api/books?report=sales&from=${from}&to=${to}`);
      setReport(d.report);
    } catch { /* toast */ } finally { setBusy(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <SectionCard title="تقرير مبيعات الكتب" icon={<BarChart3 className="w-4 h-4" />}>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-muted-foreground">من</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-10 rounded-xl border border-input bg-card px-3 text-sm font-bold" dir="ltr" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-muted-foreground">لحد</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-10 rounded-xl border border-input bg-card px-3 text-sm font-bold" dir="ltr" />
        </div>
        <button onClick={load} disabled={busy}
          className="h-10 rounded-xl border border-border bg-card font-bold px-3.5 text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> تحديث
        </button>
      </div>

      {!report ? <Loading label="جاري التقرير..." /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="نسخ اتباعت" value={report.unitsSold} icon={<BookOpen className="w-4 h-4" />} />
            <MoneyStat label="الإيراد" piastres={report.revenue} icon={<TrendingUp className="w-4 h-4" />} tone="brand" />
            <MoneyStat label="التكلفة" piastres={report.cost} icon={<Store className="w-4 h-4" />} />
            <MoneyStat label="الربح الإجمالي" piastres={report.grossProfit} icon={<TrendingUp className="w-4 h-4" />} tone={report.grossProfit >= 0 ? "success" : "danger"} />
          </div>

          <div>
            <h4 className="text-sm font-extrabold mb-2">الأكثر مبيعًا</h4>
            {report.topSelling.length === 0 ? (
              <p className="text-sm font-bold text-muted-foreground">مفيش مبيعات في الفترة دي.</p>
            ) : (
              <div className="overflow-x-auto nk-scroll">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b bg-muted/40">
                      <th className="text-start font-bold px-3 py-2 rounded-s-xl">الكتاب</th>
                      <th className="text-start font-bold px-3 py-2">نسخ</th>
                      <th className="text-start font-bold px-3 py-2">إيراد</th>
                      <th className="text-start font-bold px-3 py-2">تكلفة</th>
                      <th className="text-start font-bold px-3 py-2 rounded-e-xl">ربح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topSelling.map((b) => (
                      <tr key={b.name} className="border-b last:border-0">
                        <td className="px-3 py-2.5 font-bold">{b.name}</td>
                        <td className="px-3 py-2.5 nk-num font-extrabold" dir="ltr">{b.units}</td>
                        <td className="px-3 py-2.5 nk-num font-bold" dir="ltr">{fmt(b.revenue)} ج</td>
                        <td className="px-3 py-2.5 nk-num font-bold text-muted-foreground" dir="ltr">{fmt(b.cost)} ج</td>
                        <td className="px-3 py-2.5 nk-num font-extrabold text-emerald-700 dark:text-emerald-300" dir="ltr">{fmt(b.revenue - b.cost)} ج</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {report.lowStock.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
              قرب يخلص: {report.lowStock.map((b) => `${b.name} (${b.stock})`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// =====================================================================
// Restock dialog (manager)

function RestockDialog({ book, onClose, onDone }: {
  book: BookRow | null; onClose: () => void; onDone: () => void;
}) {
  const [qty, setQty] = useState(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (book) setQty(10); }, [book]);
  if (!book) return null;
  const bk = book;

  async function restock() {
    if (qty === 0) { toast.error("اكتب كمية صح."); return; }
    setBusy(true);
    try {
      await api("/api/books", { method: "PATCH", body: { id: bk.id, addStock: qty } });
      toast.success(qty > 0
        ? `تم توريد ${qty} نسخة — المتاح دلوقتي ${bk.stock + qty}.`
        : `تم خصم ${-qty} نسخة — المتاح دلوقتي ${bk.stock + qty}.`);
      onDone();
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!book} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="w-5 h-5 nk-brand-text" /> توريد مخزون
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm font-extrabold flex items-center justify-between">
            <span className="truncate">{book.name}</span>
            <span className="nk-num text-xs text-muted-foreground" dir="ltr">متاح {book.stock}</span>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={() => setQty((n) => n - 1)} className="w-11 h-11 rounded-xl border-2 border-input bg-card grid place-items-center active:scale-95 transition">
              <Minus className="w-4 h-4" />
            </button>
            <span className="nk-num w-20 text-center font-extrabold text-2xl">{qty > 0 ? `+${qty}` : qty}</span>
            <button type="button" onClick={() => setQty((n) => n + 1)} className="w-11 h-11 rounded-xl border-2 border-input bg-card grid place-items-center active:scale-95 transition">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex justify-center gap-2">
            {[5, 10, 20, 50].map((n) => (
              <button key={n} type="button" onClick={() => setQty(n)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-extrabold nk-num hover:bg-muted/60 transition">
                +{n}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground font-bold text-center">
            الكمية بالموجب = وصل نسخ جديدة · بالسالب = تسوية مخزون ناقص
          </p>

          <div className="flex gap-2">
            <button onClick={restock} disabled={busy}
              className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
              تأكيد التوريد
            </button>
            <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Delete confirm (manager)

function DeleteBookDialog({ book, onClose, onDone }: {
  book: BookRow | null; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!book) return null;
  const bk = book;

  async function del() {
    setBusy(true);
    try {
      const res = await api<{ archived?: boolean }>(`/api/books?id=${bk.id}`, { method: "DELETE" });
      toast.success(res.archived ? "الكتاب اتأرشف — سجل المبيعات القديمة اتحفظ." : "تم حذف الكتاب.");
      onDone();
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!book} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <Trash2 className="w-5 h-5" /> حذف كتاب
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm font-bold leading-relaxed">
          متأكد إنك عايز تشيل <span className="nk-brand-text">{book.name}</span> من المخزون؟
          <span className="block text-xs text-muted-foreground font-semibold mt-1.5">
            لو الكتاب ده عليه مبيعات قديمة، هنأرشفه بدل ما نحذفه عشان حساباتك تفضل مظبوطة.
          </span>
        </p>
        <div className="flex gap-2">
          <button onClick={del} disabled={busy}
            className="flex-1 bg-rose-600 text-white font-extrabold rounded-xl py-3 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
            أيوة، احذفه
          </button>
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
