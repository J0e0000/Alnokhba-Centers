"use client";

/* More views: Requests (approvals), Smart Insights (فريق التحليل),
   Reports (analytics foundation), Settings (subjects/curriculum/terms/
   permissions), Audit log (spec §8, §13, §26-30, §32) */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Check, X, BrainCircuit, RefreshCw, Plus, ScrollText,
  ShieldCheck, ListTree, CalendarRange, Lock, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acaApi, ApiErr, fmtDate, DOW_AR, fmt12, type AcaUserClient } from "./client";
import { cn } from "@/lib/utils";

/* ================= REQUESTS ================= */

type ReqRow = {
  id: string; type: string; status: string;
  payload: { date?: string; startTime?: string; endTime?: string; reason?: string; schedule?: { dayOfWeek: number; startTime: string; endTime: string } };
  requester: string; group: { name: string; teacher: string } | null;
  decidedBy: string | null; decisionNote: string | null; createdAt: string;
};

const REQ_TYPE: Record<string, string> = { RESCHEDULE: "تغيير موعد", CANCEL: "إلغاء حصة", MAKEUP: "حصة تعويضية", SUBSTITUTE: "بدل مدرس", OTHER: "أخرى" };

export function RequestsView({ user }: { user: AcaUserClient }) {
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const canApprove = user.permissions.includes("requests.approve");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await acaApi<{ requests: ReqRow[] }>("/api/academia/requests");
      setRows(d.requests);
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    try {
      await acaApi("/api/academia/requests", { method: "PATCH", body: JSON.stringify({ requestId: id, approve }) });
      toast.success(approve ? "اتوافق واتطبق الطلب" : "اترفض الطلب");
      load();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-black">{canApprove ? "طلبات محتاجة قرار" : "طلباتي"}</h2>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <ScrollText className="w-9 h-9 mx-auto text-muted-foreground" />
          <p className="font-extrabold mt-2">مفيش طلبات</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-white/80 dark:bg-white/5 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-extrabold text-sm">{REQ_TYPE[r.type]} {r.group ? `— ${r.group.name}` : ""}</p>
                <span className={cn("text-[10px] font-black px-2 py-1 rounded-full shrink-0",
                  r.status === "PENDING" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                  r.status === "APPROVED" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
                  r.status === "REJECTED" && "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                )}>{r.status === "PENDING" ? "مستنى" : r.status === "APPROVED" ? "اتبقّى" : "اترفض"}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                من {r.requester} · {fmtDate(r.createdAt.slice(0, 10))}
                {r.payload.date ? ` · ${r.payload.date}${r.payload.startTime ? ` ${r.payload.startTime}` : ""}` : ""}
                {r.payload.schedule ? ` · ${DOW_AR[r.payload.schedule.dayOfWeek]} ${r.payload.schedule.startTime}` : ""}
              </p>
              {r.payload.reason && <p className="text-xs font-bold mt-1">السبب: {r.payload.reason}</p>}
              {r.decisionNote && <p className="text-xs text-muted-foreground mt-1">قرار: {r.decisionNote} ({r.decidedBy})</p>}
              {canApprove && r.status === "PENDING" && (
                <div className="flex gap-2 mt-2.5">
                  <Button size="sm" className="rounded-xl font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => decide(r.id, true)}>
                    <Check className="w-4 h-4" /> موافقة
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl font-extrabold text-red-600 dark:text-rose-300" onClick={() => decide(r.id, false)}>
                    <X className="w-4 h-4" /> رفض
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= SMART INSIGHTS (فريق التحليل) ================= */

type InsightRow = { id: string; dimension: string; severity: string; title: string; body: string; status: string; createdAt: string; data?: string | null };
type InsightData = { insights: InsightRow[]; lastRun: { startedAt: string; status: string } | null; role: string };

const DIM_LABEL: Record<string, string> = { ACADEMIC: "أكاديمي", OPERATIONAL: "تشغيلي", FINANCIAL: "مالي", STRATEGIC: "استراتيجي" };

export function InsightsView({ user: _user }: { user: AcaUserClient }) {
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [sevFilter, setSevFilter] = useState<string>("ALL");
  const [dimFilter, setDimFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await acaApi<InsightData>("/api/academia/insights")); }
    catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await acaApi<{ throttled: boolean; message?: string; generated?: number }>("/api/academia/insights", { method: "POST" });
      if (r.throttled) toast.message("التحليل مجدول", { description: r.message });
      else toast.success(`اتولدت ${r.generated} رؤية جديدة`);
      load();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setRunning(false); }
  };

  const dismiss = async (id: string) => {
    await acaApi("/api/academia/insights", { method: "PATCH", body: JSON.stringify({ insightId: id, status: "DISMISSED" }) }).catch(() => {});
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2"><BrainCircuit className="w-6 h-6 nk-brand-text" /> فريق التحليل</h2>
          <p className="text-sm text-muted-foreground mt-0.5">رؤى ذكية بتتولد في نافذة تحليل مجدولة — مش بتشتغل مع كل حصة، ومش بتظهر في سير العمل الصفي.</p>
        </div>
        <Button size="sm" disabled={running} className="rounded-xl font-extrabold nk-brand-bg text-white shrink-0" onClick={run}>
          <RefreshCw className={cn("w-4 h-4", running && "animate-spin")} /> شغّل التحليل
        </Button>
      </div>

      {/* فلاتر (spec §5): الفئة + الخطورة */}
      {!loading && data && data.insights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ k: "ALL", l: "الكل" }, { k: "CRITICAL", l: "حرج" }, { k: "WARNING", l: "تحتاج انتباه" }, { k: "INFO", l: "للمتابعة" }].map((s) => (
            <button key={s.k} onClick={() => setSevFilter(s.k)}
              className={cn("rounded-full border px-3 py-1 text-[11px] font-extrabold",
                sevFilter === s.k ? "nk-brand-bg text-white border-transparent" : "border-border text-muted-foreground bg-white/70 dark:bg-white/5")}>
              {s.l}
            </button>
          ))}
          <span className="w-px bg-border mx-1" aria-hidden />
          {[{ k: "ALL", l: "كل الفئات" }, ...Object.entries(DIM_LABEL).map(([k, l]) => ({ k, l }))].map((s) => (
            <button key={s.k} onClick={() => setDimFilter(s.k)}
              className={cn("rounded-full border px-3 py-1 text-[11px] font-extrabold",
                dimFilter === s.k ? "nk-brand-bg text-white border-transparent" : "border-border text-muted-foreground bg-white/70 dark:bg-white/5")}>
              {s.l}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : !data || data.insights.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <EyeOff className="w-9 h-9 mx-auto text-muted-foreground" />
          <p className="font-extrabold mt-2">مفيش رؤى حالياً</p>
          <p className="text-sm text-muted-foreground">الرؤية بتتولد بس لما يكون فيها أثر حقيقي — مفيش ضجة بلا قيمة.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {data.insights
            .filter((i) => (sevFilter === "ALL" || i.severity === sevFilter) && (dimFilter === "ALL" || i.dimension === dimFilter))
            .map((i) => {
              // الأدلة (spec §5): أرقام من الداتا بت backing الرؤية
              let evidence: string[] = [];
              try {
                const d = i.data ? (JSON.parse(i.data) as Record<string, unknown>) : null;
                if (d) evidence = Object.entries(d)
                  .filter(([k, v]) => !Array.isArray(v) && typeof v !== "object" && v != null)
                  .slice(0, 4)
                  .map(([k, v]) => `${k}: ${String(v)}`);
              } catch { evidence = []; }
              return (
            <div key={i.id} className={cn("rounded-2xl border p-3.5",
              i.severity === "CRITICAL" ? "border-red-300 bg-red-50/70 dark:bg-red-950/30 dark:border-red-800" :
              i.severity === "WARNING" ? "border-amber-300 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-800" :
              "border-border bg-white/80 dark:bg-white/5")}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-extrabold text-sm">{i.title}</p>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-muted shrink-0">{DIM_LABEL[i.dimension]}</span>
              </div>
              <p className="text-sm mt-1 leading-relaxed">{i.body}</p>
              {evidence.length > 0 && (
                <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2 space-y-0.5">
                  <p className="text-[10px] font-black text-muted-foreground">الأدلة من الداتا:</p>
                  {evidence.map((e, x) => <p key={x} className="text-[11px] font-bold text-muted-foreground nk-num" dir="ltr">• {e}</p>)}
                </div>
              )}
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-muted-foreground">{fmtDate(i.createdAt.slice(0, 10))}</span>
                <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs font-bold text-muted-foreground" onClick={() => dismiss(i.id)}>
                  إخفاء
                </Button>
              </div>
            </div>
              );
            })}
        </div>
      )}

      {data?.lastRun && (
        <p className="text-[11px] text-muted-foreground text-center">
          آخر تحليل: {fmtDate(data.lastRun.startedAt.slice(0, 10))} — الحالة: {data.lastRun.status === "DONE" ? "تم" : data.lastRun.status}
        </p>
      )}
    </div>
  );
}

/* ================= REPORTS ================= */

type ReportData = {
  window: { from: string; to: string };
  groups: { name: string; subject: { name: string; color: string }; teacher: string; sessions: number; attendanceRate: number | null }[];
  subjects: { name: string; color: string; exams: number; avg: number | null }[];
  financial: { enabled: boolean; pricedGroups: { name: string; price: number; enrolled: number; expectedMonthly: number }[] } | null;
  totals: { sessions: number; groups: number };
};

export function ReportsView({ user: _user }: { user: AcaUserClient }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    acaApi<ReportData>("/api/academia/reports").then(setData).catch((e) => e instanceof ApiErr && toast.error(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-center text-sm text-muted-foreground py-10">مشكلة في تحميل التقارير</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black">التقارير</h2>
        <p className="text-sm text-muted-foreground">آخر 4 أسابيع · {data.totals.sessions} حصة في {data.totals.groups} مجموعة</p>
      </div>

      <section>
        <h3 className="font-extrabold text-sm mb-2">الحضور حسب المجموعة</h3>
        <div className="grid gap-2">
          {data.groups.map((g) => (
            <div key={g.name} className="flex items-center gap-2.5 rounded-xl border border-border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm truncate">{g.name}</p>
                <p className="text-[11px] text-muted-foreground">{g.subject.name} · أ. {g.teacher} · {g.sessions} حصة</p>
              </div>
              <span className={cn("font-black text-sm", g.attendanceRate != null && g.attendanceRate < 60 && "text-red-600")}>
                {g.attendanceRate != null ? `${g.attendanceRate}%` : "—"}
              </span>
            </div>
          ))}
          {data.groups.length === 0 && <p className="text-sm text-muted-foreground">مفيش حصص في الفترة دي</p>}
        </div>
      </section>

      {data.subjects.length > 0 && (
        <section>
          <h3 className="font-extrabold text-sm mb-2">متوسط الدرجات حسب المادة</h3>
          <div className="grid gap-2">
            {data.subjects.map((s) => (
              <div key={s.name} className="flex items-center gap-2.5 rounded-xl border border-border p-2.5">
                <span className="font-bold text-sm flex-1">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.exams} امتحان</span>
                <span className={cn("font-black text-sm", s.avg != null && s.avg < 60 && "text-red-600")}>{s.avg != null ? `${s.avg}%` : "—"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.financial?.enabled && data.financial.pricedGroups.length > 0 && (
        <section>
          <h3 className="font-extrabold text-sm mb-2 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> المالية (بصلاحية خاصة)</h3>
          <div className="grid gap-2">
            {data.financial.pricedGroups.map((g) => (
              <div key={g.name} className="flex items-center gap-2.5 rounded-xl border border-border p-2.5">
                <span className="font-bold text-sm flex-1 truncate">{g.name}</span>
                <span className="text-[11px] text-muted-foreground">{g.enrolled} طالب</span>
                <span className="font-black text-sm">{(g.expectedMonthly / 100).toLocaleString("ar-EG")} ج/شهر</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ================= SETTINGS ================= */

export function SettingsView({ user }: { user: AcaUserClient }) {
  const canSubjects = user.permissions.includes("subjects.manage");
  const canPerms = user.permissions.includes("permissions.manage");
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-black">الإعدادات</h2>
      {canSubjects && <SubjectsManager />}
      {canSubjects && <TermsManager />}
      {!canSubjects && !canPerms && (
        <div className="rounded-3xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          الإعدادات دي للإدارة بس.
        </div>
      )}
    </div>
  );
}

function SubjectsManager() {
  const [subjects, setSubjects] = useState<{ id: string; name: string; units: { id: string; title: string; topics: { id: string; title: string }[] }[] }[]>([]);
  const [newName, setNewName] = useState("");
  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [unitTitle, setUnitTitle] = useState("");
  const [topicTitle, setTopicTitle] = useState("");

  const load = useCallback(async () => {
    const d = await acaApi<{ subjects: typeof subjects }>("/api/academia/subjects");
    setSubjects(d.subjects);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const add = async (body: Record<string, unknown>, clear: () => void) => {
    try {
      await acaApi("/api/academia/subjects", { method: "POST", body: JSON.stringify(body) });
      clear();
      load();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); }
  };

  return (
    <section className="rounded-3xl border border-border bg-white/80 dark:bg-white/5 p-4">
      <h3 className="font-extrabold text-sm flex items-center gap-1.5 mb-3"><ListTree className="w-4 h-4" /> المواد والمنهج (مادة ← وحدة ← درس ← جزء)</h3>
      <div className="flex gap-2 mb-3">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مادة جديدة" className="h-10 rounded-xl font-bold" />
        <Button size="sm" className="rounded-xl font-extrabold nk-brand-bg text-white" disabled={!newName.trim()}
          onClick={() => add({ type: "subject", name: newName }, () => setNewName(""))}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid gap-2">
        {subjects.map((s) => (
          <div key={s.id} className="rounded-2xl border border-border overflow-hidden">
            <button className="w-full text-start p-3 font-bold text-sm hover:bg-muted/40" onClick={() => setOpenSubject(openSubject === s.id ? null : s.id)}>
              {s.name} <span className="text-[11px] text-muted-foreground">· {s.units.length} وحدة</span>
            </button>
            {openSubject === s.id && (
              <div className="p-3 pt-0 space-y-2 border-t">
                {s.units.map((u) => (
                  <div key={u.id} className="text-sm">
                    <p className="font-bold">{u.title}</p>
                    <p className="text-[11px] text-muted-foreground ps-3">{u.topics.map((t) => t.title).join(" · ") || "بدون دروس"}</p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={unitTitle} onChange={(e) => setUnitTitle(e.target.value)} placeholder="وحدة جديدة" className="h-9 rounded-xl text-sm font-bold" />
                  <Button size="sm" variant="outline" className="rounded-xl font-extrabold" disabled={!unitTitle.trim()}
                    onClick={() => add({ type: "unit", subjectId: s.id, title: unitTitle }, () => setUnitTitle(""))}>إضافة</Button>
                </div>
                <div className="flex gap-2">
                  <Input value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)} placeholder="درس جديد (في أول وحدة)" className="h-9 rounded-xl text-sm font-bold" />
                  <Button size="sm" variant="outline" className="rounded-xl font-extrabold" disabled={!topicTitle.trim() || s.units.length === 0}
                    onClick={() => add({ type: "topic", unitId: s.units[0]?.id, title: topicTitle }, () => setTopicTitle(""))}>إضافة</Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TermsManager() {
  const [terms, setTerms] = useState<{ id: string; name: string; type: string; startDate: string; endDate: string; isActive: boolean }[]>([]);
  const [name, setName] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");

  const load = useCallback(async () => {
    const d = await acaApi<{ terms: typeof terms }>("/api/academia/terms");
    setTerms(d.terms);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <section className="rounded-3xl border border-border bg-white/80 dark:bg-white/5 p-4">
      <h3 className="font-extrabold text-sm flex items-center gap-1.5 mb-3"><CalendarRange className="w-4 h-4" /> التقويم الأكاديمي</h3>
      <div className="grid gap-1.5 mb-3">
        {terms.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm">
            <span className="font-bold">{t.name}</span>
            <span className="text-[11px] text-muted-foreground">{t.startDate} → {t.endDate}{t.isActive && " · شغالة"}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الفترة — الترم الثاني" className="h-10 rounded-xl font-bold flex-1 min-w-40" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-xl font-bold w-36" aria-label="من" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-xl font-bold w-36" aria-label="إلى" />
        <Button size="sm" className="rounded-xl font-extrabold nk-brand-bg text-white" disabled={!name || !from || !to}
          onClick={async () => {
            try {
              await acaApi("/api/academia/terms", { method: "POST", body: JSON.stringify({ name, startDate: from, endDate: to }) });
              setName(""); setFrom(""); setTo(""); load();
            } catch (e) { if (e instanceof ApiErr) toast.error(e.message); }
          }}>
          <Plus className="w-4 h-4" /> إضافة
        </Button>
      </div>
    </section>
  );
}

/* ================= AUDIT ================= */

type AuditRow = { id: string; userName: string; action: string; entity: string | null; before: string | null; after: string | null; reason: string | null; createdAt: string };

export function AuditView({ user: _user }: { user: AcaUserClient }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    acaApi<{ logs: AuditRow[] }>("/api/academia/audit").then((d) => setRows(d.logs)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-black flex items-center gap-2"><Lock className="w-5 h-5" /> سجل التدقيق</h2>
      <p className="text-sm text-muted-foreground -mt-2">كل تغيير مهم: مين عمله وإمتى وقبل/بعد — مفيش حذف نهائي للسجلات.</p>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-1.5">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-border p-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold">{r.action}</p>
                <span className="text-[10px] text-muted-foreground shrink-0">{new Date(r.createdAt).toLocaleString("ar-EG")}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{r.userName} · {r.entity ?? "—"}</p>
              {(r.before || r.after) && (
                <p className="text-[11px] font-bold mt-1" dir="ltr">
                  {r.before ? `${r.before.slice(0, 60)} → ` : ""}{r.after ? r.after.slice(0, 60) : ""}
                </p>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">مفيش حركات مسجلة لسه</p>}
        </div>
      )}
    </div>
  );
}
