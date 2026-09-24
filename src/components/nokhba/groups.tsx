"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Layers, Plus, Pencil, BookOpen, GraduationCap, Users, Loader2, Trash2, Banknote, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt } from "./lib";
import { PageHeader, Chip, Loading, EmptyState, SectionCard } from "./shared";
import { Field, inputCls } from "./students";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Academics = {
  grades: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  teachers: { id: string; name: string; phone: string | null; isActive: boolean; loginCode: string | null }[];
  groups: {
    id: string; name: string; subject: string; subjectId: string; grade: string; gradeId: string;
    teacher: string | null; teacherId: string | null; price: number; teacherPercent: number;
    room: string | null; students: number; schedules: number;
  }[];
};

const TABS = [
  { id: "groups", label: "المجموعات", icon: <Layers className="w-4 h-4" /> },
  { id: "subjects", label: "المواد", icon: <BookOpen className="w-4 h-4" /> },
  { id: "grades", label: "المراحل", icon: <GraduationCap className="w-4 h-4" /> },
  { id: "teachers", label: "المدرسين", icon: <Users className="w-4 h-4" /> },
] as const;

export function GroupsView() {
  const [data, setData] = useState<Academics | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("groups");
  const [dialog, setDialog] = useState<{ mode: "group" | "subject" | "grade" | "teacher"; editId?: string } | null>(null);

  const load = () => api<Academics>("/api/academics").then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader title="المجموعات" subtitle="المجموعات والمواد والمراحل والمدرسين" />

      <div className="flex gap-1.5 overflow-x-auto nk-scroll pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-2xl border px-4 py-2.5 font-extrabold text-sm transition flex items-center gap-2",
              tab === t.id ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:text-foreground"
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "groups" && (
        <>
          <button onClick={() => setDialog({ mode: "group" })}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98]">
            <Plus className="w-4.5 h-4.5" /> مجموعة جديدة
          </button>
          {data.groups.length === 0 ? (
            <div className="nk-card rounded-2xl"><EmptyState title="مفيش مجموعات" hint="اعمل أول مجموعة — مثلاً: فيزياء للأول الثانوي مجموعة A." /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.groups.map((g) => (
                <div key={g.id} className="nk-card rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-extrabold">{g.subject} — {g.grade}</h3>
                      <p className="text-xs text-muted-foreground font-semibold mt-0.5">مجموعة {g.name}{g.teacher ? ` · ${g.teacher}` : " · بدون مدرس"}</p>
                    </div>
                    <Chip className="bg-muted border-border shrink-0"><Banknote className="w-3 h-3" /> {fmt(g.price)} ج</Chip>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    <Chip className="bg-card border-border">{g.students} طالب</Chip>
                    <Chip className="bg-card border-border">{g.schedules} حصة/أسبوع</Chip>
                    <Chip className="bg-card border-border">للمدرس {g.teacherPercent}% · للسنتر {100 - g.teacherPercent}%</Chip>
                    {g.room && <Chip className="bg-card border-border">{g.room}</Chip>}
                  </div>
                  <div className="flex gap-1.5 mt-3 pt-3 border-t">
                    <button onClick={() => setDialog({ mode: "group", editId: g.id })}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted transition">
                      <Pencil className="w-4 h-4" /> تعديل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "subjects" && (
        <>
          <button onClick={() => setDialog({ mode: "subject" })}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2">
            <Plus className="w-4.5 h-4.5" /> مادة جديدة
          </button>
          <div className="flex flex-wrap gap-2">
            {data.subjects.map((s) => (
              <div key={s.id} className="nk-card rounded-2xl px-4 py-3 flex items-center gap-3">
                <BookOpen className="w-4.5 h-4.5 nk-brand-text" />
                <span className="font-extrabold">{s.name}</span>
                <button onClick={() => setDialog({ mode: "subject", editId: s.id })} className="text-muted-foreground hover:text-foreground" aria-label="تعديل">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ))}
            {data.subjects.length === 0 && <div className="nk-card rounded-2xl flex-1"><EmptyState title="مفيش مواد" /></div>}
          </div>
        </>
      )}

      {tab === "grades" && (
        <>
          <button onClick={() => setDialog({ mode: "grade" })}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2">
            <Plus className="w-4.5 h-4.5" /> مرحلة جديدة
          </button>
          <div className="flex flex-wrap gap-2">
            {data.grades.map((g) => (
              <div key={g.id} className="nk-card rounded-2xl px-4 py-3 flex items-center gap-3">
                <GraduationCap className="w-4.5 h-4.5 nk-brand-text" />
                <span className="font-extrabold">{g.name}</span>
                <button onClick={() => setDialog({ mode: "grade", editId: g.id })} className="text-muted-foreground hover:text-foreground" aria-label="تعديل">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ))}
            {data.grades.length === 0 && <div className="nk-card rounded-2xl flex-1"><EmptyState title="مفيش مراحل" /></div>}
          </div>
        </>
      )}

      {tab === "teachers" && (
        <>
          <button onClick={() => setDialog({ mode: "teacher" })}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2">
            <Plus className="w-4.5 h-4.5" /> مدرس جديد
          </button>
          {data.teachers.length === 0 ? (
            <div className="nk-card rounded-2xl"><EmptyState title="مفيش مدرسين" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.teachers.map((t) => {
                const groups = data.groups.filter((g) => g.teacherId === t.id);
                const waLink = t.phone
                  ? `https://wa.me/2${t.phone.replace(/^0/, "")}?text=${encodeURIComponent(
                      `مرحبًا ${t.name} 👋\nدي بيانات دخول بورتال المدرس:\n📍 الرابط: ${window.location.origin}/teacher\n📱 الموبايل: ${t.phone}\n🔑 الكود: ${t.loginCode ?? "—"}\n\nجوا هتلاقي جدولك وطلابك ومستحقاتك.`,
                    )}`
                  : null;
                return (
                  <div key={t.id} className="nk-card rounded-2xl p-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <h3 className="font-extrabold">{t.name}</h3>
                        {t.phone && <p className="text-xs text-muted-foreground font-semibold nk-num mt-0.5" dir="ltr">{t.phone}</p>}
                        {/* كود بورتال المدرس */}
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-extrabold text-muted-foreground">بورتال المدرس:</span>
                          <code dir="ltr" className="text-xs font-extrabold nk-num rounded-lg bg-muted px-2 py-1 tracking-widest">{t.loginCode ?? "—"}</code>
                          {!t.phone && <span className="text-[10px] font-bold text-orange-600">محتاج موبايل</span>}
                          {waLink && (
                            <a href={waLink} target="_blank" rel="noreferrer"
                              className="text-[10px] font-extrabold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 hover:bg-emerald-100 transition">
                              ابعتله على واتساب
                            </a>
                          )}
                        </div>
                      </div>
                      <button onClick={() => setDialog({ mode: "teacher", editId: t.id })} className="text-muted-foreground hover:text-foreground" aria-label="تعديل">
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {groups.length === 0 ? (
                        <Chip className="bg-muted border-border text-muted-foreground">مربوطش بمجموعات</Chip>
                      ) : groups.map((g) => (
                        <Chip key={g.id} className="bg-card border-border">{g.subject} {g.name} · {g.teacherPercent}%</Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {dialog && (
        <AcademicDialog
          mode={dialog.mode}
          editId={dialog.editId}
          data={data}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); toast.success("تم الحفظ."); }}
        />
      )}
    </div>
  );
}

function AcademicDialog({ mode, editId, data, onClose, onSaved }: {
  mode: "group" | "subject" | "grade" | "teacher"; editId?: string; data: Academics;
  onClose: () => void; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const existing = useMemoExisting(mode, editId, data);
  // initial state computed once on mount — dialog is conditionally rendered so it remounts
  const [form, setForm] = useState(() => {
    const base = {
      name: "", gradeId: data.grades[0]?.id ?? "", subjectId: data.subjects[0]?.id ?? "",
      teacherId: "", price: "", teacherPercent: "70", room: "", phone: "",
    };
    if (mode === "group" && existing) {
      const g = existing as Academics["groups"][number];
      return {
        ...base, name: g.name, gradeId: g.gradeId, subjectId: g.subjectId,
        teacherId: g.teacherId ?? "", price: String(g.price / 100),
        teacherPercent: String(g.teacherPercent), room: g.room ?? "",
      };
    }
    if (mode === "teacher" && existing) {
      const t = existing as Academics["teachers"][number];
      return { ...base, name: t.name, phone: t.phone ?? "" };
    }
    if (existing) return { ...base, name: existing.name };
    return base;
  });

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { type: mode, name: form.name.trim() };
      if (mode === "group") {
        Object.assign(body, {
          gradeId: form.gradeId, subjectId: form.subjectId, teacherId: form.teacherId || null,
          price: parseFloat(form.price), teacherPercent: parseInt(form.teacherPercent, 10), room: form.room,
        });
      }
      if (mode === "teacher") Object.assign(body, { phone: form.phone });
      if (editId) body.id = editId;
      await api("/api/academics", { method: editId ? "PATCH" : "POST", body });
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function regenCode() {
    if (!editId || regenBusy) return;
    if (!confirm("هيتولّد كود جديد للمدرس — الكود القديم مش هيعبّر بعد كده. متأكد؟")) return;
    setRegenBusy(true);
    try {
      const res = await api<{ loginCode: string | null }>("/api/academics", {
        method: "PATCH", body: { type: "teacher", id: editId, regenCode: true },
      });
      toast.success(`الكود الجديد: ${res.loginCode}`);
      onSaved();
    } catch { /* toast */ } finally { setRegenBusy(false); }
  }

  const title = mode === "group" ? "مجموعة" : mode === "subject" ? "مادة" : mode === "grade" ? "مرحلة" : "مدرس";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader><DialogTitle>{editId ? `تعديل ${title}` : `${title} جديد`}</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          {mode === "group" ? (
            <>
              <Field label="اسم المجموعة" required hint="مثلاً: A أو B أو الأول الثانوي A">
                <input className={inputCls(false)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="A" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="المرحلة" required>
                  <select className={inputCls(false)} value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })}>
                    {data.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </Field>
                <Field label="المادة" required>
                  <select className={inputCls(false)} value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                    {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="المدرس">
                <select className={inputCls(false)} value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
                  <option value="">بدون مدرس</option>
                  {data.teachers.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="سعر الحصة (ج)" required>
                  <input dir="ltr" inputMode="decimal" className={cn(inputCls(false), "text-center nk-num")} value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, "") })} placeholder="65" />
                </Field>
                <Field label="% المدرس" required hint="الباقي للسنتر">
                  <input dir="ltr" inputMode="numeric" className={cn(inputCls(false), "text-center nk-num")} value={form.teacherPercent}
                    onChange={(e) => setForm({ ...form, teacherPercent: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} placeholder="70" />
                </Field>
                <Field label="القاعة">
                  <input className={inputCls(false)} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="قاعة 2" />
                </Field>
              </div>
            </>
          ) : mode === "teacher" ? (
            <>
              <Field label="اسم المدرس" required>
                <input className={inputCls(false)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="أ. محمد حسن" />
              </Field>
              <Field label="الموبايل" hint="لازم عشان يدخل بورتال المدرس">
                <input dir="ltr" inputMode="numeric" className={cn(inputCls(false), "nk-num")} value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d]/g, "").slice(0, 11) })} placeholder="01xxxxxxxxx" />
              </Field>
              {editId && (
                <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-extrabold text-muted-foreground">كود بورتال المدرس</p>
                      <code dir="ltr" className="text-lg font-extrabold nk-num tracking-[0.25em]">{(existing as Academics["teachers"][number] | null)?.loginCode ?? "—"}</code>
                    </div>
                    <button
                      onClick={regenCode}
                      disabled={regenBusy}
                      className="rounded-xl border border-border bg-card font-bold text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-60"
                    >
                      {regenBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                      كود جديد
                    </button>
                  </div>
                  <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">
                    المدرس بيدخل من <span dir="ltr" className="nk-num">/teacher</span> بموبايله + الكود ده — بيشوف جدوله وطلابه ومستحقاته.
                  </p>
                </div>
              )}
            </>
          ) : (
            <Field label={mode === "subject" ? "اسم المادة" : "اسم المرحلة"} required>
              <input className={inputCls(false)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={mode === "subject" ? "فيزياء" : "الأول الثانوي"} />
            </Field>
          )}

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />} حفظ
            </button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useMemoExisting(mode: string, editId: string | undefined, data: Academics) {
  if (!editId) return null;
  if (mode === "group") return data.groups.find((g) => g.id === editId) ?? null;
  if (mode === "teacher") return data.teachers.find((t) => t.id === editId) ?? null;
  if (mode === "subject") return data.subjects.find((s) => s.id === editId) ?? null;
  if (mode === "grade") return data.grades.find((g) => g.id === editId) ?? null;
  return null;
}
