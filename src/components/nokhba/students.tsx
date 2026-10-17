"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  UserPlus, Users, Phone, ChevronLeft, X, Loader2, GraduationCap, BookOpen,
  CheckSquare, Square, Printer, XCircle, Layers, MessageSquareText,
  Plus, Trash2, ClipboardPaste, Copy, Check, Download, MessageCircle,
  QrCode, PartyPopper, ShieldCheck, RotateCcw, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneIntl, smartPhoneDigits } from "@/lib/normalize";
import { api, fmt, normalizeDigits, prefetchApi, STUDENT_STATUS, userCan, type SessionUser } from "./lib";
import { PageHeader, Chip, BalanceChip, EmptyState, Loading, CardsSkeleton } from "./shared";
import { ContactActions } from "./contact-actions";
import { StudentSearchBar } from "./student-search";
import { StudentCardPrint } from "./cards";
import { SmartPhoneInput } from "./smart-phone-input";
import { buildWaUrl, openWhatsAppHandoff } from "./wa";
import { SendQueueModal, type ReportStudent } from "./session-report";
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
  // فلاتر المرحلة والمجموعة (فكرة الريبو المرجعي — مدموجة مع مجموعات النخبة)
  const [gradeId, setGradeId] = useState("");
  const [groupId, setGroupId] = useState("");
  const academics = useAcademics();
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
      if (gradeId) params.set("gradeId", gradeId);
      if (groupId) params.set("groupId", groupId);
      api<{ students: StudentRow[]; total: number }>(`/api/students?${params}`)
        .then(setData)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, gradeId, groupId, reloadKey]);

  const canAdd = user.role === "MANAGER" || user.canAddStudents;
  // تدقيق المرحلة 2 #6: القراءة نفسها صلاحية — من غيرها بنعرض حالة قفل وديعة (السيرفر بيفضل الحارس الحقيقي)
  const canView = userCan(user, "VIEW_STUDENTS");
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
  // رسالة واتساب للمحددين (نقل من المنصة الأساسية: اكتب مرة → تخصص لكل طالب → إرسال يدوي)
  const [bulkMsgOpen, setBulkMsgOpen] = useState(false);
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
                  title="تاب واحدة سريعة: صف لكل طالب — الاسم ورقمين والدفعة كلها تُسجل مرة واحدة"
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

      {/* فلاتر المرحلة والمجموعة — فكرة الريبو المرجعي (فلتر مرحلة مقسّم يفصل المراحل بصريًا)
          مدموجة مع فلتر مجموعات النخبة — بتشتغل مع البحث والحالة مع بعض */}
      {(academics?.grades.length ?? 0) > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex gap-1.5 overflow-x-auto nk-scroll">
            <button
              onClick={() => { setGradeId(""); setGroupId(""); }}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5",
                !gradeId ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground"
              )}
            >
              <GraduationCap className="w-3.5 h-3.5" /> كل المراحل
            </button>
            {academics!.grades.map((g) => (
              <button
                key={g.id}
                onClick={() => { setGradeId(g.id === gradeId ? "" : g.id); setGroupId(""); }}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition",
                  gradeId === g.id ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground"
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
          {(academics?.groups.length ?? 0) > 0 && (
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-10 shrink-0 rounded-full border border-border bg-card px-3.5 text-xs font-bold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-56"
            >
              <option value="">كل المجموعات</option>
              {academics!.groups.filter((g) => !gradeId || g.gradeId === gradeId).map((g) => (
                <option key={g.id} value={g.id}>{g.subject} — {g.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {loading && !data ? (
        <CardsSkeleton count={6} />
      ) : !canView ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<ShieldCheck className="w-8 h-8" />}
            title="عرض الطلاب مقفول لحسابك"
            hint="الحساب ده مش معاه صلاحية «عرض الطلاب» — كلّم المدير يوزّها من إدارة الموظفين."
          />
        </div>
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
                onPointerEnter={() => void prefetchApi(`/api/students/${s.id}`)}
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
                    {s.phone ? <><Phone className="w-3 h-3" /> <span className="nk-num" dir="ltr">{formatPhoneIntl(s.phone)}</span></> : <>{s.subjects.length} مادة</>}
                  </span>
                </div>
                {/* تواصل مباشر: اتصال/واتساب للطالب + ولي الأمر (spec §2) */}
                {(s.phone || s.parentPhone) && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-between gap-2 border-t border-border/50 pt-2"
                  >
                    <span className="text-[10px] font-bold text-muted-foreground">تواصل مباشر</span>
                    <ContactActions target={s} size="sm" />
                  </div>
                )}
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
            <button
              onClick={() => { if (selected.size === 0) { toast.error("اختار طالب على الأقل."); return; } setBulkMsgOpen(true); }}
              disabled={selected.size === 0}
              title="اكتب الرسالة مرة واحدة — بتتخصص باسم كل طالب"
              className="rounded-xl px-4 py-2.5 font-extrabold text-sm border border-[color-mix(in_srgb,var(--c-primary)_35%,white)] dark:border-[color-mix(in_srgb,var(--c-primary)_57%,#0d1420)] bg-card nk-brand-text flex items-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              <MessageCircle className="w-4.5 h-4.5" /> رسالة
            </button>
            <button onClick={exitSelect} className="rounded-xl border border-border bg-card p-2.5 text-muted-foreground hover:bg-muted/50" title="إلغاء">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <BulkMessageDialog
        open={bulkMsgOpen}
        onClose={() => setBulkMsgOpen(false)}
        rows={rows.filter((s) => selected.has(s.id)).map((s) => ({
          id: s.id, name: s.name, code: s.code, phone: s.phone ?? s.parentPhone,
        }))}
        centerName={user.center?.name ?? ""}
      />

      <StudentCardPrint open={!!cardIds} onClose={() => setCardIds(null)} studentIds={cardIds ?? []} center={user.center} />

      <StudentFormDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); onOpenNewConsumed(); }}
        onCreated={(s) => {
          setReloadKey((k) => k + 1);
          toast.success(`تم تسجيل ${s.name} — كود ${s.code} · لينك البورتال جاهز تحت 👇`);
        }}
        onOpenProfile={(id) => { setShowAdd(false); onOpenNewConsumed(); onOpenProfile(id); }}
        user={user}
      />

      <BulkAddDialog
        open={showBulk}
        centerName={user.center?.name ?? null}
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

export function StudentFormDialog({ open, onClose, onCreated, onOpenProfile, user }: {
  open: boolean; onClose: () => void;
  /** بينادي أول ما الطالب يتسجل — القائمة بتتحدث في الخلفية والدايلوج يفضل مفتوح على شاشة النجاح */
  onCreated: (s: { id: string; code: string; name: string }) => void;
  onOpenProfile: (id: string) => void;
  user: SessionUser;
}) {
  const academics = useAcademics();
  const [step, setStep] = useState<"form" | "done">("form");
  const [saved, setSaved] = useState<{ id: string; code: string; name: string; qrToken: string; phone: string; parentPhone: string } | null>(null);
  const [form, setForm] = useState({
    name: "", phone: "", parentName: "", parentPhone: "", gradeId: "",
    school: "", groupIds: [] as string[], status: "ACTIVE", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  // فكرة الريبو المرجعي: المجموعة هي المرجع لمرحلة الطالب + تحذير لما المرحلة تغيّر وتبیل مجموعات
  const [gradeInherited, setGradeInherited] = useState(false);
  const [droppedGroups, setDroppedGroups] = useState(0);
  const firstErrorRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  // هل المستخدم عدّل اسم ولي الأمر بإيده؟ (لولا بنستنتجه من اسم الطالب)
  const parentTouched = useRef(false);

  // فتح الفورم = فورم نضيف + تركيز على اسم الطالب على طول (فكرة الريبو المرجعي)
  useEffect(() => {
    if (open) {
      setErrors({}); setStep("form"); setSaved(null); setQrDataUrl(null); setCopied(false);
      setGradeInherited(false); setDroppedGroups(0);
      setForm({ name: "", phone: "", parentName: "", parentPhone: "", gradeId: "", school: "", groupIds: [], status: "ACTIVE", notes: "" });
      parentTouched.current = false;
      setTimeout(() => nameRef.current?.focus(), 150);
    }
  }, [open]);

  // المرحلة الافتراضية أول ما المراحل توصل — توفير خطوة (فلسفة «السريعة») من غير ما نمسح اختيار المستخدم
  useEffect(() => {
    if (open) setForm((f) => ({ ...f, gradeId: f.gradeId || (academics?.grades[1]?.id ?? academics?.grades[0]?.id ?? "") }));
  }, [open, academics]);

  const gradeGroups = useMemo(
    () => academics?.groups.filter((g) => !form.gradeId || g.gradeId === form.gradeId) ?? [],
    [academics, form.gradeId]
  );

  function set(k: keyof typeof form, v: unknown) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  }

  // فكرة الريبو المرجعي: اختيار مجموعة والمرحلة فاضية → المرحلة بتتورّث من المجموعة
  // (المجموعة هي المرجع) — والإضافة تتم من غير مرحلة غلط خالص.
  function toggleGroup(id: string) {
    const g = academics?.groups.find((x) => x.id === id);
    if (!g) return;
    const checked = form.groupIds.includes(id);
    if (!checked && !form.gradeId && g.gradeId) {
      setForm((f) => ({ ...f, gradeId: g.gradeId, groupIds: [...f.groupIds, id] }));
      setGradeInherited(true);
      setDroppedGroups(0);
      setErrors((e) => ({ ...e, gradeId: "" }));
      return;
    }
    set("groupIds", checked ? form.groupIds.filter((x) => x !== id) : [...form.groupIds, id]);
  }

  // فكرة الريبو المرجعي: تغيير المرحلة بيفصل المجموعات غير المتوافقة قبل الحفظ — مع تحذير واضح
  function changeGrade(v: string) {
    setGradeInherited(false);
    const compatible = new Set((academics?.groups ?? []).filter((g) => !v || g.gradeId === v).map((g) => g.id));
    const kept = form.groupIds.filter((id) => compatible.has(id));
    setDroppedGroups(form.groupIds.length - kept.length);
    setForm((f) => ({ ...f, gradeId: v, groupIds: kept }));
    setErrors((e) => ({ ...e, gradeId: "" }));
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
      const res = await api<{ student: { id: string; code: string; name: string; qrToken: string } }>("/api/students", {
        method: "POST",
        body: { ...form, phone, parentPhone: pphone },
      });
      const s = {
        id: res.student.id, code: res.student.code, name: res.student.name,
        qrToken: res.student.qrToken, phone, parentPhone: pphone,
      };
      setSaved(s);
      setStep("done");
      onCreated(s);
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  // «إضافة طالب تاني» — فورم نضيف من غير ما نقفل الدايلوج
  function addAnother() {
    setForm({ name: "", phone: "", parentName: "", parentPhone: "", gradeId: academics?.grades[1]?.id ?? academics?.grades[0]?.id ?? "", school: "", groupIds: [], status: "ACTIVE", notes: "" });
    parentTouched.current = false;
    setErrors({}); setSaved(null); setQrDataUrl(null); setCopied(false);
    setGradeInherited(false); setDroppedGroups(0);
    setStep("form");
    setTimeout(() => nameRef.current?.focus(), 100);
  }

  // ===== شاشة النجاح — لينك البورتال + الرسالة (نفس صياغة StudentQrLinkModal) =====
  const portalLink = typeof window !== "undefined" && saved?.qrToken
    ? `${window.location.origin}/portal?qr=${saved.qrToken}`
    : "";

  useEffect(() => {
    if (step !== "done" || !portalLink) { setQrDataUrl(null); return; }
    let cancelled = false;
    setQrBusy(true);
    import("qrcode")
      .then((QR) => QR.toDataURL(portalLink, {
        width: 560,
        margin: 4, // هامش واسع — السكرين شوت يتقري من أي كاميرا (نفس إصلاح الريبو المرجعي)
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      }))
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); })
      .finally(() => { if (!cancelled) setQrBusy(false); });
    return () => { cancelled = true; };
  }, [step, portalLink]);

  async function copyLink(silent = false) {
    if (!portalLink) return;
    try {
      await navigator.clipboard.writeText(portalLink);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = portalLink;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        if (!silent) toast.error("انسخ اللينك يدويًا من الصندوق");
        return;
      }
    }
    setCopied(true);
    if (!silent) toast.success("لينك الطالب اتنسخ — ابعتله في أي مكان");
    setTimeout(() => setCopied(false), 2500);
  }

  function sendWhatsApp() {
    if (!portalLink || !saved || sending) return;
    const firstName = saved.name.trim().split(/\s+/)[0] ?? saved.name;
    const msg = [
      `أهلًا ${firstName}،`,
      `ده لينك بورتالك في ${user.center?.name || "السنتر"} — بيفتح من غير تسجيل دخول:`,
      portalLink,
      "احتفظ باللينك ده — رصيدك وجدولك كلهم فيه في أي وقت.",
    ].join("\n");
    const target = saved.phone || saved.parentPhone || "";
    setSending(true);
    try {
      const ok = target
        ? openWhatsAppHandoff(buildWaUrl(target, msg))
        : openWhatsAppHandoff(`https://wa.me/?text=${encodeURIComponent(msg)}`);
      if (!ok) {
        void copyLink(true);
        toast.info("واتساب اتقفل من المتصفح — نسخنا اللينك، الصقه في الشات");
      }
    } finally { setSending(false); }
  }

  function downloadQr() {
    if (!qrDataUrl || !saved) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `QR-portal-${saved.name.replace(/[\\/:*?"<>|\s]+/g, "_")}.png`;
    a.click();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto nk-scroll">
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 nk-brand-text" /> إضافة طالب جديد</DialogTitle>
            </DialogHeader>

            {!academics ? <Loading label="جاري تحميل المراحل والمجموعات..." /> : (
              <div className="space-y-3.5">
                <Field label="اسم الطالب بالكامل" required error={errors.name} ref={errors.name ? firstErrorRef : undefined}>
                  <input
                    ref={nameRef}
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
                    <>
                      <SmartPhoneInput value={form.phone} hasError={!!errors.phone} onChange={(v) => set("phone", v)} />
                      <WaHint phone={form.phone} error={!!errors.phone} />
                    </>
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
                    <>
                      <SmartPhoneInput value={form.parentPhone} hasError={!!errors.parentPhone} onChange={(v) => set("parentPhone", v)} />
                      <WaHint phone={form.parentPhone} error={!!errors.parentPhone} />
                    </>
                  </Field>
                  <Field label="المرحلة الدراسية" required error={errors.gradeId} ref={errors.gradeId ? firstErrorRef : undefined}>
                    <select className={inputCls(!!errors.gradeId)} value={form.gradeId} onChange={(e) => changeGrade(e.target.value)}>
                      <option value="">اختار المرحلة...</option>
                      {academics.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </Field>
                </div>

                {gradeInherited && (
                  <p className="text-[11px] font-bold rounded-xl px-3 py-2 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 text-sky-700 dark:text-sky-300 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    المرحلة اتحددت أوتوماتيك من المجموعة — المجموعة هي المرجع (فكرة الريبو المرجعي). عدّلها لو محتاج.
                  </p>
                )}
                {droppedGroups > 0 && (
                  <p className="text-[11px] font-bold rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {droppedGroups} مجموعة من اللي اخترتهم لا ينتموا للمرحلة الجديدة — اترفضوا تلقائيًا عشان مرحلة الطالب تفضل سليمة.
                  </p>
                )}

                <Field label="المدرسة (اختياري)">
                  <input className={inputCls(false)} value={form.school} onChange={(e) => set("school", e.target.value)} placeholder="مدرسة السلام الثانوية" />
                </Field>

                <Field
                  label="المجموعات والمواد"
                  hint={form.gradeId ? "اختار المجموعات اللي الطالب هيحضرها — ممكن أكتر من واحدة" : "اختار المرحلة الأول عشان تشوف المجموعات المتوافقة — أو اختار أي مجموعة وهنحدد مرحلتها تلقائي"}
                >
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
                            onClick={() => toggleGroup(g.id)}
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
                  الكود (5 أرقام) بيتولد أوتوماتيك — وبعد الحفظ لينك البورتال و QR بيبقوا جاهزين بضغطة
                </p>
              </div>
            )}
          </>
        ) : saved ? (
          /* ============================================================
             شاشة النجاح (فكرة الريبو المرجعي: نتيجة بعد الحفظ) مدموجة مع
             ميزة «الـ QR يبقى بضغطة» (طلب المالك) — كل حاجة في شاشة واحدة
             ============================================================ */
          <div className="space-y-4">
            <div className="text-center space-y-1 pt-1">
              <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <PartyPopper className="w-7 h-7" />
              </span>
              <h3 className="font-black text-base m-0">اتسجّل {saved.name.split(/\s+/)[0]} بنجاح!</h3>
              <p className="text-xs text-muted-foreground font-bold m-0">
                كود <span className="nk-num">{saved.code}</span> · لينك البورتال والـ QR جاهزين دلوقتي — ابعتهم في أي وقت
              </p>
            </div>

            {/* QR — بيشفّر لينك البورتال الكامل (نفس StudentQrLinkModal) */}
            <div className="rounded-2xl border border-border bg-card p-3 grid place-items-center">
              {qrBusy ? (
                <div className="h-52 grid place-items-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR بورتال — ${saved.name}`} className="w-52 h-52 rounded-xl" />
              ) : (
                <div className="h-52 grid place-items-center text-muted-foreground">
                  <QrCode className="w-10 h-10" />
                </div>
              )}
              <p className="text-[10px] font-bold text-muted-foreground mt-2">
                الطالب أو ولي الأمر يمسح الكود بكاميرا الموبايل — البورتال بيفتح مسجّل على طول
              </p>
            </div>

            {/* اللينك */}
            <div className="flex items-center gap-2 rounded-xl border border-input bg-muted/40 px-3 py-2">
              <input
                readOnly
                value={portalLink}
                dir="ltr"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-transparent text-[11px] font-bold nk-num outline-none min-w-0"
              />
              <button
                onClick={() => copyLink()}
                aria-label="نسخ اللينك"
                className="shrink-0 w-9 h-9 rounded-lg nk-brand-bg text-white grid place-items-center active:scale-95 transition"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={sendWhatsApp}
                disabled={sending}
                className="h-11 rounded-xl bg-[#25D366] text-white font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition disabled:opacity-50"
              >
                <MessageCircle className="w-4 h-4" /> ابعت واتساب
              </button>
              <button
                onClick={downloadQr}
                disabled={!qrDataUrl}
                className="h-11 rounded-xl border-2 border-border bg-card font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition disabled:opacity-40"
              >
                <Download className="w-4 h-4" /> حفظ الكود
              </button>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => onOpenProfile(saved.id)}
                className="w-full nk-brand-bg text-white font-extrabold rounded-xl py-3 shadow active:scale-[0.99] flex items-center justify-center gap-2"
              >
                <ChevronLeft className="w-4.5 h-4.5" /> افتح صفحة الطالب — اطبع كارته
              </button>
              <button
                onClick={addAnother}
                className="w-full rounded-xl border border-border bg-card font-extrabold py-3 flex items-center justify-center gap-2 active:scale-[0.99] hover:bg-muted/50 transition"
              >
                <RotateCcw className="w-4 h-4 nk-brand-text" /> إضافة طالب تاني
              </button>
            </div>

            <p className="text-[10px] font-bold text-muted-foreground flex items-start gap-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              اللينك ده هو دخول الطالب للبورتال — سيبه معاه هو أو ولي أمره بس، زي كارته بالظبط.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** معاينة واتساب لايف تحت خانة الموبايل (فكرة الريبو المرجعي) — بالصيغة الدولية الصح */
function WaHint({ phone, error }: { phone: string; error?: boolean }) {
  const digits = normalizeDigits(phone);
  if (!digits || error || !/^01[0125]\d{8}$/.test(digits)) return null;
  return (
    <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1" dir="ltr">
      <MessageCircle className="w-3 h-3" /> WhatsApp: +20 {digits.slice(1)}
    </p>
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
        <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-400">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground font-semibold">{hint}</p>
      ) : null}
    </div>
  );
}

export function inputCls(hasError: boolean): string {
  return cn(
    "w-full h-11 rounded-xl border-2 bg-card px-3.5 font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition",
    hasError ? "border-rose-300 focus-visible:ring-rose-400 dark:border-rose-700/60" : "border-input"
  );
}

/* ============================================================
   إضافة دفعة سريعة — workflow موحّد (دمج الريبو المرجعي + مميزات النخبة):
   ١) اكتب الصفوف (أو الصق قايمة جاهزة) — نفس سرعة «السريعة»
   ٢) تحقق من الكل → مراجعة سريعة للدفعة قبل الحفظ (فكرة الريبو المرجعي)
   ٣) احفظ الجميع مرة واحدة (all-or-nothing على السيرفر)
   ٤) 🎉 شاشة النتيجة: لينك بورتال جاهز لكل طالب + واتساب/نسخ بالمحدد
      — مفيش حاجة بتتبعت تلقائي أبدًا (فكرة الريبو المرجعي spec 5-7)
   ============================================================ */
type QuickRow = { key: number; name: string; phone: string; parentName: string; parentPhone: string; parentTouched: boolean };
type BulkResultStudent = { id: string; name: string; code: string; qrToken: string; phone: string };
let quickRowKey = 0;
const emptyQuickRow = (): QuickRow => ({ key: ++quickRowKey, name: "", phone: "", parentName: "", parentPhone: "", parentTouched: false });
const digitsOnly = (s: string) => smartPhoneDigits(s);
const isEgyptianMobile = (s: string) => /^01[0125]\d{8}$/.test(s);

// لينك بورتال الطالب (بيشفّر اللينك الكامل مش التوكن الخام — زي StudentQrLinkModal)
function buildPortalLink(qrToken: string): string {
  return typeof window === "undefined" ? "" : `${window.location.origin}/portal?qr=${qrToken}`;
}
// رسالة الدخول — نفس صياغة StudentQrLinkModal عشان الرسايل تبقى موحّدة في التطبيق كله
function buildPortalMessage(name: string, link: string, centerName: string | null): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return [
    `أهلًا ${first}،`,
    `ده لينك بورتالك في ${centerName || "السنتر"} — بيفتح من غير تسجيل دخول:`,
    link,
    "احتفظ باللينك ده — رصيدك وجدولك كلهم فيه في أي وقت.",
  ].join("\n");
}
// نسخ احتياطي (المتصفحات القديمة) — نفس fallback StudentQrLinkModal
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}

function BulkAddDialog({ open, onClose, onSaved, centerName }: {
  open: boolean;
  onClose: () => void;
  onSaved: (count: number) => void;
  centerName: string | null;
}) {
  const academics = useAcademics();
  // wizard: edit → review → saving → result (فكرة الريبو المرجعي)
  const [step, setStep] = useState<"edit" | "review" | "saving" | "result">("edit");
  const [gradeId, setGradeId] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [rows, setRows] = useState<QuickRow[]>([]);
  const [pasteMode, setPasteMode] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<number, string>>({});
  // شاشة النتيجة
  const [created, setCreated] = useState<BulkResultStudent[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [linkFilter, setLinkFilter] = useState<"all" | "phone" | "nophone">("all");
  const finishedRef = useRef(false);

  // لما يتفتح: صفوف فاضية جاهزة للكتابة فورًا
  useEffect(() => {
    if (!open) return;
    finishedRef.current = false;
    setErrs({}); setPasteMode(false); setText(""); setGroupIds([]);
    setRows(Array.from({ length: 4 }, emptyQuickRow));
    setStep("edit"); setCreated([]); setPicked(new Set()); setLinkFilter("all");
  }, [open]);

  // المرحلة الافتراضية أول ما المراحل توصل — من غير ما نمسح اختيار المستخدم
  useEffect(() => {
    if (!open || !academics) return;
    setGradeId((g) => g || (academics.grades[1]?.id ?? academics.grades[0]?.id ?? ""));
  }, [open, academics]);

  const gradeGroups = useMemo(
    () => academics?.groups.filter((g) => !gradeId || g.gradeId === gradeId) ?? [],
    [academics, gradeId]
  );
  const gradeName = academics?.grades.find((g) => g.id === gradeId)?.name ?? "";

  function patch(key: number, changes: Partial<QuickRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...changes } : r)));
    setErrs((e) => {
      if (!e[key]) return e;
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
  }

  const addRow = () => setRows((rs) => (rs.length >= 100 ? rs : [...rs, emptyQuickRow()]));
  const removeRow = (key: number) => setRows((rs) => {
    const next = rs.filter((r) => r.key !== key);
    return next.length ? next : Array.from({ length: 2 }, emptyQuickRow);
  });

  // استنتاج اسم ولي الأمر من اسم الطالب (نفس استنتاج الإضافة الفردية)
  function setName(r: QuickRow, v: string) {
    if (!r.parentTouched) {
      const parts = v.trim().split(/\s+/).filter(Boolean);
      const dad = parts.length >= 2 ? parts[1] : "";
      patch(r.key, { name: v, parentName: dad });
    } else {
      patch(r.key, { name: v });
    }
  }

  const filled = rows.filter((r) => r.name.trim() || digitsOnly(r.phone) || digitsOnly(r.parentPhone));

  function validate(): boolean {
    const e: Record<number, string> = {};
    filled.forEach((r, i) => {
      const no = i + 1;
      const name = r.name.trim();
      if (name.replace(/\s/g, "").length < 6) { e[r.key] = `صف ${no}: الاسم قصير — اكتب الاسم كامل (3 أسماء زي: أحمد محمد علي).`; return; }
      const ph = digitsOnly(r.phone);
      const pp = digitsOnly(r.parentPhone);
      if (!ph && !pp) { e[r.key] = `صف ${no}: اكتب رقم موبايل واحد على الأقل (طالب أو ولي أمر).`; return; }
      if (ph && !isEgyptianMobile(ph)) { e[r.key] = `صف ${no}: موبايل الطالب لازم 11 رقم يبدأ بـ 010/011/012/015.`; return; }
      if (pp && !isEgyptianMobile(pp)) { e[r.key] = `صف ${no}: موبايل ولي الأمر لازم 11 رقم يبدأ بـ 010/011/012/015.`; return; }
    });
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  // خطوة ٢: تحقق من الكل → مراجعة (التحقق قبل الحفظ — فكرة الريبو المرجعي)
  function goReview() {
    if (filled.length === 0) { toast.error("اكتب طالب واحد على الأقل — صف لكل طالب."); return; }
    if (!validate()) { toast.error("في صفوف فيها بيانات ناقصة أو غلط — اتصححها الأول."); return; }
    setStep("review");
  }

  // خطوة ٣: حفظ الجميع — all-or-nothing على السيرفر
  async function save() {
    // بنحتفظ بمفتاح كل صف بالترتيب عشان أخطاء السيرفر (أرقام الصفوف) ترجع للصف الصح
    const payload = filled.map((r) => ({
      key: r.key,
      data: {
        name: r.name.trim(),
        phone: digitsOnly(r.phone),
        parentName: r.parentName.trim(),
        parentPhone: digitsOnly(r.parentPhone),
        gradeId: gradeId || undefined,
        groupIds,
      },
    }));
    setBusy(true);
    try {
      const res = await api<{ created: number; students: BulkResultStudent[] }>("/api/students/bulk", {
        method: "POST",
        body: { students: payload.map((p) => p.data) },
      });
      const list = res.students ?? [];
      setCreated(list);
      setPicked(new Set(list.filter((s) => s.phone).map((s) => s.id)));
      setLinkFilter("all");
      setStep("result");
    } catch (err) {
      // أخطاء الصفوف من السيرفر (422) → رجوع للتعديل مع تمييز الصفوف نفسها بالأحمر
      const data = (err as Error & { data?: { errors?: { row: number; message: string }[] } }).data;
      if (data?.errors?.length) {
        const e: Record<number, string> = {};
        for (const re of data.errors) {
          const target = payload[re.row - 1];
          if (target) e[target.key] = `صف ${re.row}: ${re.message}`;
        }
        setErrs(e);
      }
      setStep("edit");
    } finally { setBusy(false); }
  }

  // ===== شاشة النتيجة — إجراءات لينك البورتال لكل طالب =====
  const visibleCreated = created.filter((s) => {
    if (linkFilter === "phone") return !!s.phone;
    if (linkFilter === "nophone") return !s.phone;
    return true;
  });
  const phoneCount = created.filter((s) => !!s.phone).length;
  const pickedReady = created.filter((s) => picked.has(s.id) && s.phone);

  function togglePicked(id: string) {
    setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // واتساب لطالب واحد — handoff بيفهم iOS والديسكتوب، ولو الـ popup اتقفل بنسخ الرسالة
  function sendOne(s: BulkResultStudent) {
    const link = buildPortalLink(s.qrToken);
    const msg = buildPortalMessage(s.name, link, centerName);
    const ok = openWhatsAppHandoff(buildWaUrl(s.phone, msg));
    if (!ok) {
      void copyText(`${s.name}\n${msg}`);
      toast.info("واتساب اتقفل من المتصفح — نسخنا رسالة الطالب، الصقها في الشات");
    }
  }

  // نسخ رسائل المحددين — الإرسال بإيدك انت، مفيش حاجة بتتبعت تلقائي أبدًا
  async function copyPickedMessages() {
    if (!pickedReady.length) { toast.error("اختار طلاب عندهم رقم موبايل الأول."); return; }
    const allText = pickedReady
      .map((s) => `${s.name}\n${buildPortalMessage(s.name, buildPortalLink(s.qrToken), centerName)}`)
      .join("\n\n———\n\n");
    const ok = await copyText(allText);
    if (ok) toast.success(`رسايل ${pickedReady.length} طالب اتنسخت — الصقها في واتساب.`);
    else toast.error("المتصفح منع النسخ — انسخ كل رسالة لوحدها.");
  }

  // خلاص → onSaved بيقفل وبيحدّث القائمة (شغّال من زرار خلاص وX برضه)
  function finish() {
    if (finishedRef.current) { onClose(); return; }
    finishedRef.current = true;
    onSaved(created.length);
  }
  function handleClose() {
    if (step === "result" && created.length > 0) { finish(); return; }
    onClose();
  }

  // لصق قايمة جاهزة — بيفهم الصيغتين:
  // الجديدة:  اسم ، موبايل الطالب ، موبايل ولي الأمر
  // القديمة:  اسم ، موبايل الطالب ، اسم ولي الأمر ، موبايل ولي الأمر
  function applyPaste() {
    const isPhone = (s: string) => { const d = digitsOnly(s); return d.length >= 9 && d.length <= 14 && /^\d+$/.test(d); };
    const parsed = text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/\t|,|،|\||;/).map((p) => p.trim()).filter(Boolean);
      const r = emptyQuickRow();
      r.name = parts[0] ?? "";
      if (parts[1] && isPhone(parts[1])) r.phone = digitsOnly(parts[1]);
      if (parts.length >= 4) {
        if (parts[2] && !isPhone(parts[2])) { r.parentName = parts[2]; r.parentTouched = true; }
        if (parts[3] && isPhone(parts[3])) r.parentPhone = digitsOnly(parts[3]);
        else if (parts[2] && isPhone(parts[2])) r.parentPhone = digitsOnly(parts[2]);
      } else if (parts.length === 3) {
        if (isPhone(parts[2])) r.parentPhone = digitsOnly(parts[2]);
        else { r.parentName = parts[2]; r.parentTouched = true; }
      }
      return r;
    }).filter((r) => r.name.length > 0);
    if (parsed.length === 0) { toast.error("مفيش سطور مفهومة — اتأكد إن كل سطر فيه اسم على الأقل."); return; }
    setRows(parsed.slice(0, 100));
    setErrs({});
    setPasteMode(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto nk-scroll">
        {step === "result" ? (
          /* ============================================================
             شاشة النتيجة 🎉 (فكرة الريبو المرجعي spec 5-7 مدموجة مع لينك
             بورتال النخبة): اختيار لكل طالب + فلاتر + واتساب/نسخ + معاينة
             ============================================================ */
          <div className="space-y-3">
            <div className="text-center space-y-1 pt-1">
              <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 mx-auto">
                <PartyPopper className="w-7 h-7" />
              </span>
              <h3 className="text-base font-black m-0">تم تسجيل {created.length} طالب بنجاح!</h3>
              <p className="text-xs text-muted-foreground font-bold m-0 mt-1">
                لينك بورتال جاهز لكل طالب تحت — اختار مين يستلمه. مفيش حاجة اتبعتت تلقائي أبدًا.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {([
                ["all", `الكل (${created.length})`],
                ["phone", `عندهم رقم (${phoneCount})`],
                ["nophone", `من غير رقم (${created.length - phoneCount})`],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setLinkFilter(key)}
                  className={cn("rounded-full border px-3 py-1.5 text-xs font-bold transition",
                    linkFilter === key ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground")}>
                  {label}
                </button>
              ))}
              <button onClick={() => setPicked(new Set(visibleCreated.filter((s) => s.phone).map((s) => s.id)))}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground">
                <CheckSquare className="w-3.5 h-3.5 inline me-1" /> تحديد الظاهرين
              </button>
            </div>

            <div className="grid gap-1.5 max-h-64 overflow-y-auto nk-scroll">
              {visibleCreated.map((s) => {
                const isPicked = picked.has(s.id) && !!s.phone;
                return (
                  <div key={s.id} className={cn(
                    "flex items-center gap-2 rounded-xl border-2 p-2.5 transition",
                    isPicked ? "border-transparent nk-brand-bg-soft ring-2 ring-[var(--c-primary)]" : "border-border bg-card"
                  )}>
                    <input type="checkbox" className="w-4.5 h-4.5 accent-[var(--c-primary)] cursor-pointer shrink-0"
                      checked={isPicked} disabled={!s.phone} onChange={() => togglePicked(s.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold truncate m-0">{s.name}</p>
                      <p className="text-[11px] font-bold text-muted-foreground m-0">
                        كود <span className="nk-num">{s.code}</span>
                        {s.phone ? <> · <span className="nk-num" dir="ltr">{formatPhoneIntl(s.phone)}</span></> : " · مفيش رقم واتساب صحيح"}
                      </p>
                    </div>
                    {s.phone ? (
                      <span className="flex items-center gap-1 shrink-0">
                        <button onClick={() => sendOne(s)} title="ابعت لينك البورتال واتساب"
                          className="w-9 h-9 rounded-lg bg-[#25D366] text-white grid place-items-center active:scale-95 transition">
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await copyText(`${s.name}\n${buildPortalMessage(s.name, buildPortalLink(s.qrToken), centerName)}`);
                            if (ok) toast.success(`رسالة ${s.name.split(/\s+/)[0]} اتنسخت`);
                            else toast.error("المتصفح منع النسخ");
                          }}
                          title="نسخ رسالة الطالب"
                          className="w-9 h-9 rounded-lg border border-border bg-card grid place-items-center text-muted-foreground active:scale-95 transition">
                          <Copy className="w-4 h-4" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-muted-foreground border border-border rounded-full px-2 py-1 shrink-0">بلا رقم</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* معاينة رسالة أول طالب محدد (سياق قبل النسخ — فكرة الريبو المرجعي) */}
            {pickedReady[0] && (
              <div className="rounded-xl p-3 text-[11px] leading-6 whitespace-pre-line bg-muted/50 border border-border">
                <b className="block mb-1 text-[10px] text-muted-foreground">معاينة رسالة {pickedReady[0].name.split(/\s+/)[0]}:</b>
                {buildPortalMessage(pickedReady[0].name, buildPortalLink(pickedReady[0].qrToken), centerName)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
              <button onClick={() => void copyPickedMessages()} disabled={pickedReady.length === 0}
                className="flex-1 min-w-36 rounded-xl border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] dark:border-[color-mix(in_srgb,var(--c-primary)_57%,#0d1420)] bg-card nk-brand-text font-extrabold py-3 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50">
                <Copy className="w-4.5 h-4.5" /> نسخ رسائل المحدد ({pickedReady.length})
              </button>
              <button onClick={() => finish()}
                className="flex-1 min-w-36 nk-brand-bg text-white rounded-xl py-3 font-extrabold flex items-center justify-center gap-2 shadow active:scale-[0.98]">
                <Check className="w-4.5 h-4.5" /> خلاص — تمام
              </button>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground m-0 flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              الإرسال بإيدك انت: زرار الواتساب بيفتح شات الطالب والرسالة جاهزة — ولينك كل طالب بيتفتح من غير تسجيل دخول.
            </p>
          </div>
        ) : (
          /* ============================================================
             edit / review / saving — نفس فورم «السريعة» بس بخطوة مراجعة
             ============================================================ */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Layers className="w-5 h-5 nk-brand-text" /> إضافة دفعة سريعة</DialogTitle>
            </DialogHeader>

            <p className="text-[12px] font-bold text-muted-foreground leading-relaxed">
              {step === "edit" && "صف لكل طالب: الاسم + موبايل الطالب + موبايل ولي الأمر — رقم واحد كفاية لو التاني فاضي. وبعد التعبئة اضغط «تحقق من الكل» تراجع قبل الحفظ."}
              {step === "review" && "كل الصفوف سليمة ✓ — بص على الملخص واضغط «احفظ الجميع». أي خطأ على السيرفر هيرجعك للتعديل من غير ما حاجة تتسجل."}
            </p>

            {step === "edit" && (
              <>
                {/* المرحلة والمجموعات — مرة واحدة للدفعة كلها بدل سؤال كل صف */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="المرحلة الدراسية (للدفعة كلها)">
                    <select className={inputCls(false)} value={gradeId} onChange={(e) => { setGradeId(e.target.value); setGroupIds([]); }}>
                      <option value="">بدون مرحلة — تقدر تضيفها بعدين</option>
                      {(academics?.grades ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </Field>
                </div>
                {gradeId && gradeGroups.length > 0 && (
                  <Field label="المجموعات (اختياري — كل الطلبة هيتسجلوا فيها)">
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto nk-scroll">
                      {gradeGroups.map((g) => {
                        const on = groupIds.includes(g.id);
                        return (
                          <button key={g.id} type="button"
                            onClick={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
                              on ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground"
                            )}>
                            {g.subject} — {g.name}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}
              </>
            )}

            {step === "review" && (
              <div className="rounded-2xl border-2 border-dashed border-border bg-muted/30 p-3 space-y-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 nk-brand-text" /> {filled.length} طالب</span>
                  <span className="flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5 nk-brand-text" /> {gradeName || "من غير مرحلة"}</span>
                  {groupIds.length > 0 && <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5 nk-brand-text" /> {groupIds.length} مجموعة</span>}
                  <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5 nk-brand-text" /> {filled.filter((r) => digitsOnly(r.phone)).length} عندهم رقم طالب</span>
                </div>
                <div className="max-h-40 overflow-y-auto nk-scroll grid gap-1">
                  {filled.map((r, i) => (
                    <div key={r.key} className="flex items-center justify-between gap-2 text-xs font-bold bg-card rounded-lg px-2.5 py-1.5 border border-border/60">
                      <span className="truncate">{i + 1}. {r.name.trim()}</span>
                      <span className="text-muted-foreground nk-num" dir="ltr">{formatPhoneIntl(digitsOnly(r.phone) || digitsOnly(r.parentPhone))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === "saving" && (
              <div className="py-10 grid place-items-center gap-2 text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin nk-brand-text" />
                <p className="text-sm font-extrabold">جاري حفظ الجميع — ثواني...</p>
              </div>
            )}

            {step === "edit" && (pasteMode ? (
              <div className="space-y-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  dir="rtl"
                  placeholder={"يوسف السيد إبراهيم، 01012345678، 01555555555\nمريم أحمد علي، 01198765432\nمصطفى كامل، 01234567890، أحمد كامل، 01098765432"}
                  className="w-full rounded-xl border border-border bg-card p-3 font-bold text-[13px] leading-relaxed focus:outline-none focus:ring-2 nk-focus"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-muted-foreground">
                    سطر لكل طالب — الفواصل: فاصلة / تاب / | — والصيغة القديمة (باسم ولي الأمر) بتتفهم لوحدها.
                  </span>
                  <button onClick={applyPaste} className="nk-brand-bg text-white rounded-xl px-4 py-2.5 font-extrabold text-sm shrink-0 active:scale-[0.98]">
                    املأ الصفوف
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_32px] gap-2 px-1 text-[11px] font-bold text-muted-foreground">
                  <span>اسم الطالب</span><span>موبايل الطالب</span><span>موبايل ولي الأمر</span><span>اسم ولي الأمر (أوتوماتيك)</span><span />
                </div>
                {rows.map((r, i) => {
                  const err = errs[r.key];
                  return (
                    <div key={r.key} className={cn(
                      "grid gap-2 rounded-xl border-2 p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_32px] sm:items-center transition",
                      err ? "border-rose-300 bg-rose-50/40 dark:bg-rose-950/40 dark:border-rose-700/60" : "border-border bg-card"
                    )}>
                      <input dir="rtl" className={cn(inputCls(false), "h-10 text-sm")} value={r.name}
                        onChange={(e) => setName(r, e.target.value)}
                        placeholder={`صف ${i + 1} — اسم الطالب بالكامل`} />
                      <SmartPhoneInput className="h-10 [&>input]:h-10 [&>input]:text-sm" value={r.phone}
                        onChange={(v) => patch(r.key, { phone: v })} placeholder="01xxxxxxxxx" />
                      <SmartPhoneInput className="h-10 [&>input]:h-10 [&>input]:text-sm" value={r.parentPhone}
                        onChange={(v) => patch(r.key, { parentPhone: v })} placeholder="01xxxxxxxxx" />
                      <input dir="rtl" className={cn(inputCls(false), "h-10 text-sm hidden sm:block", !r.parentTouched && r.parentName && "text-muted-foreground")}
                        value={r.parentName}
                        onChange={(e) => patch(r.key, { parentName: e.target.value, parentTouched: e.target.value.trim().length > 0 })}
                        placeholder="بيتكتب لوحده" />
                      <button onClick={() => removeRow(r.key)} title="شيل الصف"
                        className="justify-self-end sm:justify-self-center rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button onClick={addRow} disabled={rows.length >= 100}
                    className="rounded-xl border border-border bg-card px-3.5 py-2.5 font-extrabold text-sm flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-50">
                    <Plus className="w-4 h-4 nk-brand-text" /> صف جديد
                  </button>
                  <button onClick={() => { setPasteMode(true); }}
                    className="text-[12px] font-extrabold text-muted-foreground underline underline-offset-4 flex items-center gap-1 hover:text-foreground transition">
                    <ClipboardPaste className="w-3.5 h-3.5" /> عندك قايمة جاهزة؟ الصقها هنا
                  </button>
                </div>
              </div>
            ))}

            {/* أخطاء الصفوف — من العميل أو من السيرفر */}
            {step === "edit" && Object.values(errs).some(Boolean) && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 p-3 space-y-1 max-h-28 overflow-y-auto nk-scroll">
                {Object.values(errs).filter(Boolean).map((m, i) => (
                  <p key={i} className="text-xs font-bold text-rose-700 dark:text-rose-300">{m}</p>
                ))}
              </div>
            )}

            {step !== "saving" && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-extrabold text-muted-foreground nk-num">
                  {step === "edit" && `${filled.length} طالب جاهزين للتسجيل${rows.length > filled.length ? ` (${rows.length - filled.length} فاضيين)` : ""}`}
                  {step === "review" && `جاهزين للحفظ: ${filled.length} طالب`}
                </span>
                <div className="flex items-center gap-2">
                  {step === "edit" ? (
                    <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card px-4 py-2.5 font-extrabold text-sm">
                      إلغاء
                    </button>
                  ) : (
                    <button onClick={() => setStep("edit")} disabled={busy} className="rounded-xl border border-border bg-card px-4 py-2.5 font-extrabold text-sm">
                      رجوع للتعديل
                    </button>
                  )}
                  {step === "edit" ? (
                    <button
                      onClick={goReview}
                      disabled={busy || filled.length === 0}
                      className="nk-brand-bg text-white rounded-xl px-5 py-2.5 font-extrabold text-sm shadow active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"
                    >
                      <CheckSquare className="w-4 h-4" /> تحقق من الكل ({filled.length})
                    </button>
                  ) : (
                    <button
                      onClick={() => { void save(); }}
                      disabled={busy}
                      className="nk-brand-bg text-white rounded-xl px-5 py-2.5 font-extrabold text-sm shadow active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"
                    >
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />} احفظ الجميع ({filled.length})
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
   رسالة واتساب للمحددين (نقل من المنصة الأساسية — CustomMessageModal):
   اكتب الرسالة مرة واحدة → بتتخصص لكل طالب ({studentName} {code} {center})
   → طابور إرسال يدوي (wa.me واحد واحد — مفيش حاجة بتتبعت تلقائيًا).
============================================================ */
function BulkMessageDialog({ open, onClose, rows, centerName }: {
  open: boolean;
  onClose: () => void;
  rows: { id: string; name: string; code: string; phone: string | null }[];
  centerName: string;
}) {
  const [text, setText] = useState("");
  const [queue, setQueue] = useState<ReportStudent[] | null>(null);

  const withPhone = rows.filter((r) => r.phone && r.phone.trim());
  const preview = text
    .replaceAll("{studentName}", withPhone[0]?.name ?? "اسم الطالب")
    .replaceAll("{code}", withPhone[0]?.code ?? "الكود")
    .replaceAll("{center}", centerName);

  const start = () => {
    if (text.trim().length < 2) { toast.error("اكتب الرسالة الأول."); return; }
    if (withPhone.length === 0) { toast.error("المحددين دول مفيش فيهم رقم موبايل."); return; }
    const items: ReportStudent[] = withPhone.map((r) => ({
      studentId: r.id, name: r.name, code: r.code,
      statusType: "present", statusLabel: "محدد",
      phone: r.phone,
    }));
    setQueue(items);
  };

  if (queue) {
    return (
      <SendQueueModal
        items={queue}
        customMessage={(s) => text
          .replaceAll("{studentName}", s.name)
          .replaceAll("{code}", s.code)
          .replaceAll("{center}", centerName)}
        onClose={() => { setQueue(null); onClose(); }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageCircle className="w-5 h-5 nk-brand-text" /> رسالة واتساب — {rows.length} طالب</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="bulk-msg" className="text-sm font-bold">
              الرسالة — بتتخصص لكل طالب تلقائيًا
            </label>
            <textarea
              id="bulk-msg"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full min-h-[110px] rounded-xl border-2 border-input bg-card px-3.5 py-2.5 font-semibold text-sm resize-none"
              placeholder={"مثلاً:\nتنبيه لـ {studentName} — الحصة بكرة الساعة 5. 🌟\n{center}"}
            />
            <div className="flex flex-wrap gap-1.5">
              {["{studentName}", "{code}", "{center}"].map((v) => (
                <button key={v} onClick={() => setText((t) => `${t}${v}`)} className="nk-wf-ghost nk-num" dir="ltr">{v}</button>
              ))}
            </div>
          </div>
          {text.trim() && (
            <div>
              <p className="text-[11px] font-extrabold text-muted-foreground mb-1.5">معاينة (لأول طالب عنده رقم):</p>
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 p-3.5 whitespace-pre-wrap text-[13px] leading-relaxed font-semibold">
                {preview}
              </div>
            </div>
          )}
          <p className="text-[11px] font-bold text-muted-foreground">
            {withPhone.length} من {rows.length} عندهم رقم — الإرسال يدوي واحد واحد عبر واتساب، ومفيش حاجة بتتبعت تلقائيًا.
          </p>
          <div className="flex gap-2">
            <button onClick={start} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3 shadow active:scale-[0.99]">
              متابعة — تجهيز {withPhone.length} رسالة
            </button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
