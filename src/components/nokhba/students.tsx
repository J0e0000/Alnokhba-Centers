"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  UserPlus, Users, Phone, ChevronLeft, X, Loader2, GraduationCap, BookOpen,
  CheckSquare, Square, Printer, XCircle, Layers, MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, normalizeDigits, STUDENT_STATUS, type SessionUser } from "./lib";
import { PageHeader, Chip, BalanceChip, EmptyState, Loading, CardsSkeleton } from "./shared";
import { StudentSearchBar } from "./student-search";
import { StudentCardPrint } from "./cards";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type StudentRow = {
  id: string; code: string; name: string; phone: string | null; parentPhone: string | null;
  grade: string | null; status: string; subjects: string[]; balance: number;
};

export function StudentsView({ user, openNew, onOpenNewConsumed, onOpenProfile }: {
  user: SessionUser;
  openNew?: boolean;
  onOpenNewConsumed: () => void;
  onOpenProfile: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<{ students: StudentRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cardIds, setCardIds] = useState<string[] | null>(null);

  // open the add-dialog when the parent signals (render-time adjustment)
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (openNew !== prevOpenNew) {
    setPrevOpenNew(openNew);
    if (openNew) setShowAdd(true);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      api<{ students: StudentRow[]; total: number }>(`/api/students?${params}`)
        .then(setData)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, reloadKey]);

  const canAdd = user.role === "MANAGER" || user.canAddStudents;
  const rows = data?.students ?? [];

  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = data ? data.students.length > 0 && selected.size === data.students.length : false;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((data?.students ?? []).map((s) => s.id)));
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const printSelected = () => {
    if (selected.size === 0) { toast.error("اختار طالب على الأقل."); return; }
    setCardIds([...selected]);
  };
  // نسخ أرقام المحددين — للواتساب/البرودكاست بإجراء صريح من المستخدم
  const copySelectedPhones = async () => {
    const phones = rows.filter((s) => selected.has(s.id)).map((s) => s.phone).filter(Boolean) as string[];
    if (phones.length === 0) { toast.error("مفيش أرقام موبايل للمحددين دول."); return; }
    try {
      await navigator.clipboard.writeText(phones.join(", "));
      toast.success(`${phones.length} رقم اتنسخوا — الصقهم في واتساب أو أي مكان.`);
    } catch {
      toast.error("المتصفح منع النسخ — انسخ الأرقام يدوي من كارت الطالب.");
    }
  };
  const shownIds = useMemo(() => new Set(data?.students.map((s) => s.id) ?? []), [data]);
  // لو الفلتر اتغير واختار طلاب مش موجودين → نظّف
  useEffect(() => {
    if (selected.size === 0) return;
    const t = setTimeout(() => {
      setSelected((prev) => {
        const next = [...prev].filter((id) => shownIds.has(id));
        if (next.length === prev.size) return prev;
        return new Set(next);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [shownIds, selected.size]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="الطلاب"
        subtitle={data ? `${data.total} طالب في السنتر` : undefined}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setSelectMode((v) => !v)}
              className={cn(
                "font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98] border",
                selectMode ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border"
              )}
            >
              <CheckSquare className="w-4.5 h-4.5" /> {selectMode ? "خروج من التحديد" : "تحديد الكروت"}
            </button>
            {canAdd ? (
              <>
                <button
                  onClick={() => setShowBulk(true)}
                  title="سجّل دفعة طلاب مرة واحدة من قايمة ملزوقة"
                  className="bg-card border-border border font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98]"
                >
                  <Layers className="w-4.5 h-4.5 nk-brand-text" /> إضافة دفعية
                </button>
                <button
                  onClick={() => setShowAdd(true)}
                  className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98]"
                >
                  <UserPlus className="w-4.5 h-4.5" /> إضافة طالب
                </button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <StudentSearchBar
          value={q}
          onChange={setQ}
          onPick={(s) => onOpenProfile(s.id)}
          placeholder="ابحث بالاسم أو الكود أو الموبايل — اختار من النتايج على طول..."
          className="flex-1"
        />
        <div className="flex gap-1.5 overflow-x-auto nk-scroll">
          {[
            { id: "", label: "الكل" },
            { id: "ACTIVE", label: "شغال" },
            { id: "PAUSED", label: "متوقف" },
            { id: "ARCHIVED", label: "مؤرشف" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition",
                status === f.id ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <CardsSkeleton count={6} />
      ) : !data || data.students.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<Users className="w-8 h-8" />}
            title="مفيش طلاب بالمواصفات دي"
            hint={q ? `مفيش نتيجة للبحث: "${q}" — جرب الاسم الأول بس أو الكود.` : "ابدأ بإضافة أول طالب في السنتر."}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.students.map((s) => {
            const isSel = selected.has(s.id);
            return (
              <div
                key={s.id}
                onClick={() => selectMode ? toggleSel(s.id) : onOpenProfile(s.id)}
                className={cn(
                  "nk-card rounded-2xl p-4 text-start transition flex flex-col gap-2.5 cursor-pointer relative",
                  selectMode && isSel ? "ring-2 ring-[var(--c-primary)] shadow-md" : "hover:shadow-md active:scale-[0.99]"
                )}
              >
                {selectMode && (
                  <span className={cn(
                    "absolute top-3 end-3 z-10 w-6 h-6 rounded-md border-2 grid place-items-center transition",
                    isSel ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-transparent"
                  )}>
                    {isSel ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                  </span>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-10 h-10 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center font-extrabold shrink-0">
                      {s.name.trim()[0]}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-sm truncate">{s.name}</h3>
                      <p className="text-xs text-muted-foreground font-semibold">
                        كود <span className="nk-num">{s.code}</span>{s.grade ? ` · ${s.grade}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0", STUDENT_STATUS[s.status]?.cls)}>{STUDENT_STATUS[s.status]?.label}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <BalanceChip balance={s.balance} />
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-semibold">
                    {s.phone ? <><Phone className="w-3 h-3" /> <span className="nk-num" dir="ltr">{s.phone}</span></> : <>{s.subjects.length} مادة</>}
                  </span>
                </div>
                {s.subjects.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.subjects.slice(0, 3).map((sub, i) => (
                      <Chip key={i} className="bg-muted/70 border-border text-muted-foreground">{sub}</Chip>
                    ))}
                    {s.subjects.length > 3 && <Chip className="bg-muted/70 border-border text-muted-foreground">+{s.subjects.length - 3}</Chip>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== تحديد الكروت: شريط سفلي ===== */}
      {selectMode && data && data.students.length > 0 && (
        <div className="sticky bottom-3 z-30 mx-auto max-w-2xl">
          <div className="nk-glass rounded-2xl border border-border shadow-lg p-3 flex items-center gap-2">
            <button onClick={toggleAll} className="flex items-center gap-2 font-bold text-sm px-2.5 py-2 rounded-xl hover:bg-muted/50">
              {allSelected ? <CheckSquare className="w-4.5 h-4.5 nk-brand-text" /> : <Square className="w-4.5 h-4.5 text-muted-foreground" />}
              {allSelected ? "إلغاء الكل" : "الكل"}
            </button>
            <span className="font-extrabold text-sm flex-1 text-center">
              {selected.size > 0 ? `${selected.size} طالب محدد` : "اختار الطلاب"}
            </span>
            <button
              onClick={printSelected}
              disabled={selected.size === 0}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              <Printer className="w-4.5 h-4.5" /> طباعة الكروت
            </button>
            <button
              onClick={copySelectedPhones}
              disabled={selected.size === 0}
              title="انسخ أرقام المحددين للواتساب/البرودكاست — الإرسال بإيدك انت"
              className="rounded-xl px-4 py-2.5 font-extrabold text-sm border border-[color-mix(in_srgb,var(--c-primary)_35%,white)] dark:border-[color-mix(in_srgb,var(--c-primary)_57%,#0d1420)] bg-card nk-brand-text flex items-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              <MessageSquareText className="w-4.5 h-4.5" /> نسخ الأرقام
            </button>
            <button onClick={exitSelect} className="rounded-xl border border-border bg-card p-2.5 text-muted-foreground hover:bg-muted/50" title="إلغاء">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <StudentCardPrint open={!!cardIds} onClose={() => setCardIds(null)} studentIds={cardIds ?? []} center={user.center} />

      <StudentFormDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); onOpenNewConsumed(); }}
        onSaved={(id) => { setShowAdd(false); onOpenNewConsumed(); setReloadKey((k) => k + 1); toast.success("تم إضافة الطالب بنجاح — اطبعله الكارت من صفحته."); onOpenProfile(id); }}
        user={user}
      />

      <BulkAddDialog
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onSaved={(count) => {
          setShowBulk(false);
          setReloadKey((k) => k + 1);
          toast.success(`تم تسجيل ${count} طالب في دفعة واحدة — اطبع كروتهم من وضع التحديد.`);
        }}
      />
    </div>
  );
}

// =====================================================================

type Academics = {
  grades: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  groups: { id: string; name: string; subject: string; subjectId: string; grade: string; gradeId: string; teacher: string | null; price: number; teacherPercent: number }[];
};

export function useAcademics() {
  const [data, setData] = useState<Academics | null>(null);
  useEffect(() => {
    api<Academics>("/api/academics").then(setData).catch(() => {});
  }, []);
  return data;
}

export function StudentFormDialog({ open, onClose, onSaved, user }: {
  open: boolean; onClose: () => void; onSaved: (id: string) => void; user: SessionUser;
}) {
  const academics = useAcademics();
  const [form, setForm] = useState({
    name: "", phone: "", parentName: "", parentPhone: "", gradeId: "",
    school: "", groupIds: [] as string[], status: "ACTIVE", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const firstErrorRef = useRef<HTMLDivElement | null>(null);
  // هل المستخدم عدّل اسم ولي الأمر بإيده؟ (لولا بنستنتجه من اسم الطالب)
  const parentTouched = useRef(false);

  useEffect(() => {
    if (open) {
      setErrors({});
      setForm((f) => ({ ...f, gradeId: f.gradeId || (academics?.grades[1]?.id ?? academics?.grades[0]?.id ?? "") }));
    }
  }, [open, academics]);

  const gradeGroups = useMemo(
    () => academics?.groups.filter((g) => !form.gradeId || g.gradeId === form.gradeId) ?? [],
    [academics, form.gradeId]
  );

  function set(k: keyof typeof form, v: unknown) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  }

  async function save() {
    const errs: Record<string, string> = {};
    const name = form.name.trim();
    if (!name) errs.name = "اكتب اسم الطالب.";
    else if (name.replace(/\s/g, "").length < 6) errs.name = "الاسم قصير — اكتب الاسم كامل (3 أسماء زي: أحمد محمد علي).";
    const phone = normalizeDigits(form.phone);
    if (!phone) errs.phone = "اكتب موبايل الطالب.";
    else if (!/^01[0125]\d{8}$/.test(phone)) errs.phone = "الموبايل لازم 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015.";
    if (!form.parentName.trim()) errs.parentName = "اكتب اسم ولي الأمر.";
    const pphone = normalizeDigits(form.parentPhone);
    if (!pphone) errs.parentPhone = "اكتب موبايل ولي الأمر.";
    else if (!/^01[0125]\d{8}$/.test(pphone)) errs.parentPhone = "موبايل ولي الأمر لازم 11 رقم ويبدأ بـ 010/011/012/015.";
    if (!form.gradeId) errs.gradeId = "اختار مرحلة الطالب.";

    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("في بيانات ناقصة أو غلط — بص على اللي بالأحمر.");
      firstErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setBusy(true);
    try {
      const res = await api<{ student: { id: string; code: string } }>("/api/students", {
        method: "POST",
        body: { ...form, phone, parentPhone: pphone },
      });
      onSaved(res.student.id);
      setForm({ name: "", phone: "", parentName: "", parentPhone: "", gradeId: academics?.grades[1]?.id ?? "", school: "", groupIds: [], status: "ACTIVE", notes: "" });
      parentTouched.current = false;
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 nk-brand-text" /> إضافة طالب جديد</DialogTitle>
        </DialogHeader>

        {!academics ? <Loading label="جاري تحميل المراحل والمجموعات..." /> : (
          <div className="space-y-3.5">
            <Field label="اسم الطالب بالكامل" required error={errors.name} ref={errors.name ? firstErrorRef : undefined}>
              <input
                className={inputCls(!!errors.name)}
                value={form.name}
                onChange={(e) => {
                  const v = e.target.value;
                  // استنتاج اسم ولي الأمر (أول اسم بعد اسم الطالب) ما دام المستخدم ما كتبش اسم بإيده
                  if (!parentTouched.current) {
                    const parts = v.trim().split(/\s+/).filter(Boolean);
                    const dad = parts.length >= 2 ? parts[1] : "";
                    setForm((f) => ({ ...f, name: v, parentName: dad }));
                  } else {
                    setForm((f) => ({ ...f, name: v }));
                  }
                  setErrors((e) => ({ ...e, name: "" }));
                }}
                placeholder="أحمد محمد عبد العزيز"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="موبايل الطالب" required error={errors.phone} ref={errors.phone ? firstErrorRef : undefined}>
                <input dir="ltr" inputMode="numeric" className={inputCls(!!errors.phone)} value={form.phone}
                  onChange={(e) => set("phone", normalizeDigits(e.target.value).replace(/[^\d]/g, "").slice(0, 11))} placeholder="01xxxxxxxxx" />
              </Field>
              <Field
                label="اسم ولي الأمر"
                required
                error={errors.parentName}
                ref={errors.parentName ? firstErrorRef : undefined}
                hint={!parentTouched.current && form.parentName ? "استنتجناه من اسم الطالب — عدّله لو مختلف" : undefined}
              >
                <input
                  className={inputCls(!!errors.parentName)}
                  value={form.parentName}
                  onChange={(e) => {
                    const v = e.target.value;
                    // مسح الاسم بيفضّل الاستنتاج التاني تلقائيًا — لو كتب الاسم بإيده بنسيب تعديله
                    parentTouched.current = v.trim().length > 0;
                    set("parentName", v);
                  }}
                  placeholder="محمد عبد العزيز"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="موبايل ولي الأمر" required error={errors.parentPhone} ref={errors.parentPhone ? firstErrorRef : undefined}>
                <input dir="ltr" inputMode="numeric" className={inputCls(!!errors.parentPhone)} value={form.parentPhone}
                  onChange={(e) => set("parentPhone", normalizeDigits(e.target.value).replace(/[^\d]/g, "").slice(0, 11))} placeholder="01xxxxxxxxx" />
              </Field>
              <Field label="المرحلة الدراسية" required error={errors.gradeId} ref={errors.gradeId ? firstErrorRef : undefined}>
                <select className={inputCls(!!errors.gradeId)} value={form.gradeId} onChange={(e) => { set("gradeId", e.target.value); set("groupIds", []); }}>
                  <option value="">اختار المرحلة...</option>
                  {academics.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
            </div>

            <Field label="المدرسة (اختياري)">
              <input className={inputCls(false)} value={form.school} onChange={(e) => set("school", e.target.value)} placeholder="مدرسة السلام الثانوية" />
            </Field>

            <Field label="المجموعات والمواد" hint={form.gradeId ? "اختار المجموعات اللي الطالب هيحضرها" : "اختار المرحلة الأول عشان تشوف المجموعات"}>
              {gradeGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground font-semibold bg-muted/50 rounded-xl px-3 py-2.5">مفيش مجموعات للمرحلة دي — تسجل الطالب وتضيفه لمجموعة بعدين.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {gradeGroups.map((g) => {
                    const checked = form.groupIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => set("groupIds", checked ? form.groupIds.filter((x) => x !== g.id) : [...form.groupIds, g.id])}
                        className={cn(
                          "rounded-xl border-2 p-3 text-start transition",
                          checked ? "border-transparent nk-brand-bg-soft ring-2 ring-[var(--c-primary)]" : "border-border bg-card hover:border-muted-foreground/30"
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-sm flex items-center gap-1.5"><BookOpen className="w-4 h-4 nk-brand-text" /> {g.subject} — {g.name}</span>
                          {checked && <span className="nk-brand-bg text-white w-5 h-5 rounded-full grid place-items-center text-xs shrink-0">✓</span>}
                        </span>
                        <span className="block text-[11px] text-muted-foreground font-bold mt-1">
                          {g.teacher ?? "بدون مدرس"} · الحصة {fmt(g.price)} ج · للمدرس {g.teacherPercent}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field label="ملاحظات (اختياري)">
              <textarea className={cn(inputCls(false), "min-h-[64px] resize-none")} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="أي ملاحظة عن الطالب..." />
            </Field>

            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={busy}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
                حفظ الطالب
              </button>
              <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold text-center">
              الكود (5 أرقام) والـ QR بيتولدوا أوتوماتيك بعد الحفظ
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, required, error, hint, children, ref }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode; ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="space-y-1.5" ref={ref}>
      <label className="text-sm font-bold flex items-center gap-1">
        {label} {required && <span className="text-rose-500 dark:text-rose-300">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground font-semibold">{hint}</p>
      ) : null}
    </div>
  );
}

export function inputCls(hasError: boolean): string {
  return cn(
    "w-full h-11 rounded-xl border-2 bg-card px-3.5 font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition",
    hasError ? "border-rose-300 focus-visible:ring-rose-400" : "border-input"
  );
}

/* ============================================================
   إضافة دفعية (Bulk Add) — تلصق قايمة طلاب في التكست،
   السطر لكل طالب:  الاسم ، موبايل الطالب ، اسم ولي الأمر ، موبايل ولي الأمر
   الفواصل المدعومة: فاصلة / تاب / |  — الاسم والحصة اختيارية بعد الاسم.
   ============================================================ */
function BulkAddDialog({ open, onClose, onSaved }: {
  open: boolean;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\t|,|،|\||;/).map((p) => p.trim()).filter(Boolean);
        return { raw: line, name: parts[0] ?? "", phone: parts[1] ?? "", parentName: parts[2] ?? "", parentPhone: parts[3] ?? "" };
      })
      .filter((r) => r.name.length > 0);
  }, [text]);

  async function save() {
    if (parsed.length === 0) { toast.error("الصق قايمة الطلاب الأول — سطر لكل طالب."); return; }
    setBusy(true);
    try {
      const res = await api<{ created: number }>("/api/students/bulk", {
        method: "POST",
        body: {
          students: parsed.map((r) => ({
            name: r.name, phone: r.phone, parentName: r.parentName, parentPhone: r.parentPhone,
          })),
        },
      });
      onSaved(res.created);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تسجيل الدفعة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="nk-brand-text">إضافة دفعة طلاب</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] font-bold text-muted-foreground leading-relaxed">
          سطر لكل طالب: <span dir="ltr" className="nk-num">الاسم ، موبايل الطالب ، اسم ولي الأمر ، موبايل ولي الأمر</span>
          <br />
          الموبايل وبيانات ولي الأمر اختيارية — ممكن تلصق الاسم بس.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          dir="rtl"
          placeholder={"يوسف السيد إبراهيم، 01012345678\nمريم أحمد علي، 01198765432، أحمد علي، 01555555555"}
          className="w-full rounded-xl border border-border bg-card p-3 font-bold text-[13px] leading-relaxed focus:outline-none focus:ring-2 nk-focus"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-extrabold text-muted-foreground nk-num">
            {parsed.length} طالب جاهزين للتسجيل
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-xl border border-border bg-card px-4 py-2.5 font-extrabold text-sm">
              إلغاء
            </button>
            <button
              onClick={save}
              disabled={busy || parsed.length === 0}
              className="nk-brand-bg text-white rounded-xl px-5 py-2.5 font-extrabold text-sm shadow active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} سجّل الدفعة
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
