"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart3, FileSpreadsheet, Printer, Loader2, CalendarRange, Filter, Search, X,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { api, fmt, formatDateAR, todayStr } from "./lib";
import type { SessionUser } from "./lib";
import { PageHeader, MoneyStat, Stat, Loading, EmptyState } from "./shared";
import { usePrint, PrintableReport } from "./print";

type ReportCol = { key: string; label: string; type?: "text" | "money" | "number" | "date" };
type ReportData = {
  type: string; title: string; from: string; to: string;
  columns: ReportCol[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
  statCards: { label: string; value: number; kind: "money" | "number" }[];
  centerName: string;
};

type Academics = {
  subjects: { id: string; name: string }[];
  teachers: { id: string; name: string; isActive: boolean }[];
  groups: { id: string; name: string }[];
};

const REPORT_TYPES = [
  { id: "daily", label: "تقرير يومي" },
  { id: "weekly", label: "تقرير أسبوعي" },
  { id: "monthly", label: "تقرير شهري" },
  { id: "revenue-subject", label: "الإيراد حسب المادة" },
  { id: "revenue-group", label: "الإيراد حسب المجموعة" },
  { id: "revenue-teacher", label: "الإيراد حسب المدرس" },
  { id: "student-balances", label: "مستحقات الطلاب" },
  { id: "student-credits", label: "أرصدة الطلاب" },
  { id: "teacher-settlements", label: "مستحقات المدرسين" },
  { id: "center-revenue", label: "إيراد السنتر" },
  { id: "expenses", label: "المصروفات" },
  { id: "net-result", label: "الصافي" },
  { id: "cash-movement", label: "حركة الصندوق" },
  { id: "payment-history", label: "سجل الدفع" },
  { id: "session-revenue", label: "إيراد الحصص" },
];

const FILTER_LABEL: Record<string, string> = { gte: "من", lte: "إلى" };

export function ReportsView({ user }: { user: SessionUser }) {
  const today = todayStr();
  const monthStart = today.slice(0, 8) + "01";
  const [type, setType] = useState("monthly");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const print = usePrint();

  // ===== فلاتر إضافية (بتشتغل على التقارير اللي بتتأثر بيها) =====
  const [acad, setAcad] = useState<Academics | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentMatches, setStudentMatches] = useState<{ id: string; name: string; code: string }[]>([]);

  useEffect(() => {
    api<Academics>("/api/academics", { silent: true }).then(setAcad).catch(() => {});
  }, []);

  // بحث الطالب للفلتر — debounce خفيف
  useEffect(() => {
    if (!studentName.trim() || studentId) { setStudentMatches([]); return; }
    const t = setTimeout(() => {
      api<{ students: { id: string; name: string; code: string }[] }>(`/api/students?q=${encodeURIComponent(studentName)}&pageSize=8`, { silent: true })
        .then((d) => setStudentMatches(d.students ?? []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [studentName, studentId]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ type, from, to });
    if (subjectId) params.set("subjectId", subjectId);
    if (teacherId) params.set("teacherId", teacherId);
    if (groupId) params.set("groupId", groupId);
    if (studentId) params.set("studentId", studentId);
    api<ReportData>(`/api/reports?${params.toString()}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type, from, to, subjectId, teacherId, groupId, studentId]);

  useEffect(() => { load(); }, [load]);

  const query = (() => {
    const params = new URLSearchParams({ type, from, to });
    if (subjectId) params.set("subjectId", subjectId);
    if (teacherId) params.set("teacherId", teacherId);
    if (groupId) params.set("groupId", groupId);
    if (studentId) params.set("studentId", studentId);
    return params.toString();
  })();

  const hasExtraFilters = subjectId || teacherId || groupId || studentId;
  function clearFilters() {
    setSubjectId(""); setTeacherId(""); setGroupId("");
    setStudentId(""); setStudentName(""); setStudentMatches([]);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="التقارير"
        subtitle="تقارير مالية شاملة — بالفلاتر والتصدير"
        action={
          <div className="flex gap-2">
            <a href={`/api/reports?${query}&export=csv`}
              className="border border-border bg-card font-bold rounded-xl px-3.5 py-2.5 flex items-center gap-1.5 text-sm hover:bg-muted/60">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel/CSV
            </a>
            <button
              onClick={() => data && print(
                <PrintableReport data={data} center={user.center} />,
                `${data.title} — ${user.center?.name ?? "نخبة سنترز"}`,
              )}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2.5 shadow flex items-center gap-1.5 text-sm">
              <Printer className="w-4 h-4" /> طباعة / PDF
            </button>
          </div>
        }
      />

      {/* ===== filters ===== */}
      <div className="nk-card rounded-2xl p-4 space-y-3 print:hidden">
        <div className="flex items-center gap-2 font-bold text-sm text-muted-foreground">
          <Filter className="w-4 h-4" /> اختار التقرير والفترة
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="col-span-2 md:col-span-2">
            <label className="text-xs font-bold block mb-1">نوع التقرير</label>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm">
              {REPORT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold block mb-1">من يوم</label>
            <input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
          </div>
          <div>
            <label className="text-xs font-bold block mb-1">لحد يوم</label>
            <input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "النهاردة", from: today, to: today },
            { label: "آخر 7 أيام", from: todayStr(new Date(Date.now() - 6 * 86400000)), to: today },
            { label: "الشهر ده", from: monthStart, to: today },
            { label: "آخر 30 يوم", from: todayStr(new Date(Date.now() - 29 * 86400000)), to: today },
          ].map((p) => (
            <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-bold transition",
                from === p.from && to === p.to ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground")}>
              {p.label}
            </button>
          ))}
        </div>

        {/* فلاتر إضافية — المادة / المدرس / المجموعة / الطالب */}
        <div className="border-t border-border/60 pt-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted-foreground">فلاتر إضافية (اختياري)</span>
            {hasExtraFilters ? (
              <button onClick={clearFilters} className="text-[11px] font-extrabold text-rose-600 flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> مسح الفلاتر
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div>
              <label className="text-xs font-bold block mb-1">المادة</label>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm">
                <option value="">كل المواد</option>
                {acad?.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">المدرس</label>
              <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm">
                <option value="">كل المدرسين</option>
                {acad?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">المجموعة</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm">
                <option value="">كل المجموعات</option>
                {acad?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className="text-xs font-bold block mb-1">الطالب</label>
              {studentId ? (
                <div className="w-full h-11 rounded-xl border-2 nk-brand-border nk-brand-bg-soft px-3 font-bold text-sm flex items-center justify-between gap-1">
                  <span className="truncate">{studentName}</span>
                  <button onClick={() => { setStudentId(""); setStudentName(""); }}
                    aria-label="إزالة فلتر الطالب" className="shrink-0 text-rose-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="w-4 h-4 text-muted-foreground absolute top-1/2 -translate-y-1/2 start-3" />
                    <input
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="ابحث بالاسم أو الكود…"
                      className="w-full h-11 rounded-xl border-2 border-input bg-card ps-9 pe-3 font-bold text-sm"
                    />
                  </div>
                  {studentMatches.length > 0 && (
                    <div className="absolute z-20 top-full mt-1 inset-x-0 rounded-xl border border-border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto nk-scroll">
                      {studentMatches.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setStudentId(m.id); setStudentName(m.name); setStudentMatches([]); }}
                          className="w-full text-start px-3 py-2.5 hover:bg-muted/50 text-sm font-bold flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{m.name}</span>
                          <span className="nk-num text-[11px] text-muted-foreground shrink-0">{m.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground font-semibold">
            الفلاتر بتشتغل على التقارير اللي بتها — مثلاً فلتر المدرس مع «الإيراد حسب المدرس» أو مستحقاته، وفلتر الطالب مع مستحقات/أرصدة الطلاب وسجل الدفع.
          </p>
        </div>
      </div>

      {loading ? (
        <Loading label="جاري تجهيز التقرير..." />
      ) : !data || data.rows.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState icon={<BarChart3 className="w-8 h-8" />} title="مفيش بيانات في الفترة دي"
            hint="جرب توسّع الفترة أو اختار تقرير تاني." />
        </div>
      ) : (
        <div className="space-y-4">
          {/* stat cards */}
          {data.statCards.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:grid-cols-4">
              {data.statCards.map((c, i) =>
                c.kind === "money" ? (
                  <MoneyStat key={i} label={c.label} piastres={c.value} tone={i === 0 ? "brand" : "default"} />
                ) : (
                  <Stat key={i} label={c.label} value={c.value} />
                )
              )}
            </div>
          )}

          {/* chart — نظرة بيانية على الصفوف المالية (spec §6: charts where useful) */}
          {(() => {
            const labelCol = data.columns[0]?.key;
            const moneyCol = data.columns.find((c) => c.type === "money")?.key;
            if (!labelCol || !moneyCol || data.rows.length < 2) return null;
            const series = data.rows.slice(0, 14).map((r) => ({
              name: String(r[labelCol] ?? "—").slice(0, 18),
              value: Math.abs(Number(r[moneyCol] ?? 0)) / 100,
            }));
            return (
              <div className="nk-card rounded-2xl p-4 print:hidden">
                <h3 className="text-xs font-extrabold text-muted-foreground mb-3">نظرة بيانية (أول 14 صف — بالجنيه)</h3>
                <div className="h-56" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={55} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number | string) => `${Number(v).toLocaleString("en-EG")} ج`} />
                      <Bar dataKey="value" fill="var(--c-primary)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* table */}
          <div className="nk-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto nk-scroll">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    {data.columns.map((c) => (
                      <th key={c.key} className="px-3.5 py-3 text-start font-extrabold text-xs whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      {data.columns.map((c) => {
                        const v = r[c.key];
                        return (
                          <td key={c.key}
                            className={cn(
                              "px-3.5 py-2.5 whitespace-nowrap",
                              c.type === "money" && "nk-num font-extrabold",
                              c.type === "money" && Number(v) < 0 && "text-rose-600 dark:text-rose-300"
                            )}
                            dir={c.type === "money" || c.type === "number" ? "ltr" : undefined}
                            style={c.type === "money" ? { textAlign: "start" } : undefined}
                          >
                            {c.type === "money" ? fmt(Number(v)) :
                             c.type === "date" ? formatDateAR(String(v)) :
                             c.type === "number" ? String(v) :
                             String(v ?? "—")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(data.totals).length > 0 && (
                  <tfoot>
                    <tr className="bg-muted/60 border-t-2 font-extrabold">
                      {data.columns.map((c, i) => (
                        <td key={c.key} className="px-3.5 py-3 nk-num" dir={c.type === "money" || c.type === "number" ? "ltr" : undefined} style={{ textAlign: "start" }}>
                          {i === 0 ? "الإجمالي" : data.totals[c.key] !== undefined ? (c.type === "money" ? fmt(data.totals[c.key]) : data.totals[c.key]) : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground font-semibold print:hidden flex items-center gap-1.5">
            <CalendarRange className="w-3.5 h-3.5" />
            الفترة: من {formatDateAR(data.from)} لـ {formatDateAR(data.to)} · التصدير CSV بيفتح في Excel مباشرة بالعربي.
          </p>
        </div>
      )}

      {loading && data && (
        <div className="flex justify-center print:hidden"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      )}
    </div>
  );
}
