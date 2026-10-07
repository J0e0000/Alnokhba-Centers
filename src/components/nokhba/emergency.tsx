"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload, ShieldAlert, FileSpreadsheet, Loader2, CheckCircle2,
  AlertTriangle, History, Zap, WifiOff, KeyRound, FileJson,
  PackageCheck, ShieldCheck, CalendarClock, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, timeAgoAR, type SessionUser } from "./lib";
import { PageHeader, SectionCard, EmptyState, Loading } from "./shared";

type HistoryItem = {
  kind: "excel" | "recovery";
  id: string; fileName: string; totalRows: number;
  imported: number; duplicates: number; conflicts: number; skipped: number;
  importedByName: string; createdAt: string;
};

type RecoveryConflict = {
  txnId: string; seq: number; op: string; opAr: string;
  entity: string; entityName: string; field: string;
  offlineValue: string; onlineValue: string; ts: string;
  suggestion: string; code: string;
};

type RecoveryPreview = {
  packageId: string; centerName: string;
  period: { from: string; to: string };
  exportedAt: string | null;
  totalTxns: number; valid: number; duplicates: number; conflicts: number; invalid: number;
  collected: number;
  preview: {
    valid: { txnId: string; seq: number; op: string; actor: string; amount: number | null; ts: string }[];
    conflicts: RecoveryConflict[];
    invalid: { txnId: string; reason: string }[];
  };
  message: string;
};

type RecoveryResult = {
  imported: number; duplicates: number; conflicts: number; skipped: number;
  message: string; conflictDetails: { txnId?: string; reason: string }[];
};

export function EmergencyView({ user }: { user: SessionUser }) {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  // استيراد ملف الاسترداد
  const [recFile, setRecFile] = useState<{ name: string; data: unknown } | null>(null);
  const [recPreview, setRecPreview] = useState<RecoveryPreview | null>(null);
  const [recBusy, setRecBusy] = useState<"preview" | "commit" | null>(null);
  const [recResult, setRecResult] = useState<RecoveryResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "apply" | "skip">>({});
  const recInputRef = useRef<HTMLInputElement>(null);

  // إكسل الأسبوع (الوضع الكلاسيكي)
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; conflicts: number; message: string; conflictDetails: { reason: string }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ history: HistoryItem[] }>("/api/emergency").then((d) => setHistory(d.history)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  function downloadPackage() {
    toast.info("جاري تجهيز حزمة الطوارئ — بتتوقّع وتتنزّل دلوقتي…");
    window.location.href = "/api/emergency?package=1";
  }

  // ===== ملف الاسترداد =====
  function pickRecoveryFile(f: File | null) {
    setRecPreview(null); setRecResult(null); setRecFile(null); setDecisions({});
    if (!f) return;
    if (!/\.json$/i.test(f.name)) { toast.error("ملف الاسترداد لازم يكون JSON (ALNOKHBA_EMERGENCY_RECOVERY_…)."); return; }
    if (f.size > 25 * 1024 * 1024) { toast.error("الملف كبير أوي (أقصى 25 ميجا)."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data?.typ !== "ALNOKHBA_EMERGENCY_RECOVERY") {
          toast.error("الملف ده مش ملف استرداد طوارئ AlNokhba Management.");
          return;
        }
        setRecFile({ name: f.name, data });
        toast.success("الملف جاهز — اعمل فحص (معاينة).");
      } catch {
        toast.error("مش قادر أقرأ الملف — تأكد إنه نازل من نظام الطوارئ من غير تعديل.");
      }
    };
    reader.onerror = () => toast.error("مش قادر أقرأ الملف.");
    reader.readAsText(f);
  }

  async function recoveryAction(action: "recovery-preview" | "recovery-commit") {
    if (!recFile) { toast.error("اختار ملف الاسترداد الأول."); return; }
    setRecBusy(action === "recovery-preview" ? "preview" : "commit");
    try {
      const res = await fetch("/api/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, recovery: recFile.data, decisions }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "حصلت مشكلة في قراءة الملف — جرب تاني.");
        return;
      }
      if (action === "recovery-preview") {
        setRecPreview(data as RecoveryPreview);
        setRecResult(null);
        toast.success((data as RecoveryPreview).message);
      } else {
        setRecResult(data as RecoveryResult);
        setRecPreview(null);
        setRecFile(null);
        setDecisions({});
        if (recInputRef.current) recInputRef.current.value = "";
        toast.success((data as RecoveryResult).message);
        load();
      }
    } catch {
      toast.error("مفيش اتصال بالسيرفر — بص على النت وجرب تاني.");
    } finally {
      setRecBusy(null);
    }
  }

  // ===== إكسل الأسبوع (كلاسيكي) =====
  async function analyze(action: "preview" | "commit") {
    if (!file) {
      toast.error("اختار ملف الإكسل الأول.");
      return;
    }
    setBusy(action);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("action", action);
      const res = await fetch("/api/emergency", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "حصلت مشكلة في قراءة الملف — جرب تاني.");
        return;
      }
      if (action === "preview") {
        setPreview(data as PreviewData);
        setResult(null);
        toast.success((data as PreviewData).message);
      } else {
        setResult(data);
        setPreview(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        toast.success((data as { message: string }).message);
        load();
      }
    } catch {
      toast.error("مفيش اتصال بالسيرفر — بص على النت وجرب تاني.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="الطوارئ"
        subtitle="نظام طوارئ أوفلاين لمدة 7 أيام — حزمة HTML موقّعة تشتغل من غير نت + استرداد محكوم"
      />

      {/* ===== المبدأ ===== */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm font-bold text-amber-800 leading-relaxed">
          نزّل <b>حزمة الطوارئ</b> خلاص دلوقتي وخليها على جهاز الاستقبال — الرخصة بتبقى شغّالة
          <span className="nk-num"> ٧ أيام </span> من التوليد وموقّعة من السيرفر.
          <span className="block text-amber-700 font-semibold mt-1">
            لو النت قطع: افتح الملف من الجهاز — بحث QR/كود · حضور · دفع بالباقي · اشتراكات · حصص — وكل معاملة بياخد كود فريد ETX.
          </span>
        </div>
      </div>

      {/* ===== 1) تنزيل حزمة الطوارئ ===== */}
      <SectionCard title="① حزمة الطوارئ (أوفلاين — HTML)" icon={<PackageCheck className="w-4 h-4" />}>
        <button
          onClick={downloadPackage}
          className="w-full nk-brand-grad text-white font-extrabold rounded-2xl px-4 py-5 shadow flex items-center justify-center gap-3 active:scale-[0.99] transition"
        >
          <WifiOff className="w-6 h-6" />
          <span className="text-start">
            <span className="block text-base">نزّل نظام الطوارئ (7 أيام أوفلاين)</span>
            <span className="block text-[11px] font-semibold text-white/95">
              ملف واحد شغّال من غير نت · بحث بالـ QR والكود · حضور ودفع واشتراكات · تصدير إكسل + ملف استرداد
            </span>
          </span>
        </button>
        <div className="grid sm:grid-cols-4 gap-2 mt-3 text-[11px] font-bold text-muted-foreground">
          <span className="bg-muted/60 border border-border rounded-xl px-3 py-2 flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 text-amber-500" /> رخصة 7 أيام من التوليد</span>
          <span className="bg-muted/60 border border-border rounded-xl px-3 py-2 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5 nk-brand-text" /> موقّعة RSA من السيرفر</span>
          <span className="bg-muted/60 border border-border rounded-xl px-3 py-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 nk-brand-text" /> مربوطة بالسنتر (عزل كامل)</span>
          <span className="bg-muted/60 border border-border rounded-xl px-3 py-2 flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> استرداد محكوم بمعاملات</span>
        </div>
        <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-[11.5px] font-bold text-muted-foreground leading-relaxed">
          بعد انتهاء الـ 7 أيام التطبيق بيتحوّل <b>قراءة + تصدير بس</b> — والحزمة الجديدة بتتطلب من هنا (للسنترات المشتركة النشطة). تعديل أي حرف جوّه الملف يكسر التوقيع → التطبيق بيرفض يشتغل.
        </div>
      </SectionCard>

      {/* ===== 2) استيراد ملف الاسترداد ===== */}
      <SectionCard title="② استيراد ملف الاسترداد (SYNC BACK)" icon={<Upload className="w-4 h-4" />}>
        <div className="space-y-3">
          <button
            onClick={() => recInputRef.current?.click()}
            className={cn(
              "w-full rounded-2xl border-2 border-dashed p-5 text-center transition",
              recFile ? "border-[color:var(--c-primary)] bg-[color-mix(in_srgb,var(--c-primary)_6%,white)]" : "border-border bg-card hover:border-[color-mix(in_srgb,var(--c-primary)_40%,white)]",
            )}
          >
            <FileJson className={cn("w-8 h-8 mx-auto mb-2", recFile ? "nk-brand-text" : "text-muted-foreground")} />
            {recFile ? (
              <>
                <p className="font-extrabold text-sm nk-brand-text">{recFile.name}</p>
                <p className="text-[11px] font-bold text-muted-foreground mt-1">جاهز للفحص — ALNOKHBA_EMERGENCY_RECOVERY</p>
              </>
            ) : (
              <>
                <p className="font-extrabold text-sm">دوس لاختيار ملف الاسترداد (JSON)</p>
                <p className="text-[11px] font-bold text-muted-foreground mt-1">النازل من نظام الطوارئ بعد ما خلصت/راجعت — زرار «تصدير ملف الاسترداد»</p>
              </>
            )}
          </button>
          <input
            ref={recInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => pickRecoveryFile(e.target.files?.[0] ?? null)}
          />

          {recFile && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => recoveryAction("recovery-preview")}
                disabled={recBusy !== null}
                className="flex-1 border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-3.5 flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
              >
                {recBusy === "preview" ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                فحص الملف (معاينة + تعارضات)
              </button>
              <button
                onClick={() => recoveryAction("recovery-commit")}
                disabled={recBusy !== null}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
              >
                {recBusy === "commit" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                زامن كل الصالح + قراراتك
              </button>
            </div>
          )}

          {/* ===== معاينة الاسترداد ===== */}
          {recPreview && (
            <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-extrabold text-sm">{recPreview.message}</p>
                <span className="text-[11px] font-bold text-muted-foreground font-mono" dir="ltr">{recPreview.packageId}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                <MiniStat label="المعاملات" value={recPreview.totalTxns} />
                <MiniStat label="جاهزة" value={recPreview.valid} tone="ok" />
                <MiniStat label="متكررة" value={recPreview.duplicates} tone="warn" />
                <MiniStat label="تعارضات" value={recPreview.conflicts} tone="bad" />
                <MiniStat label="مرفوضة" value={recPreview.invalid} tone="bad" />
                <MiniStat label="تحصيل (ج)" value={Math.round(recPreview.collected / 100)} />
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                فترة الطوارئ: {new Date(recPreview.period.from).toLocaleDateString("ar-EG")} ← {new Date(recPreview.period.to).toLocaleDateString("ar-EG")}
                {recPreview.exportedAt ? ` · اتصدر: ${new Date(recPreview.exportedAt).toLocaleString("ar-EG")}` : ""}
              </p>

              {recPreview.preview.valid.length > 0 && (
                <div>
                  <p className="text-xs font-extrabold text-muted-foreground mb-1.5">معاملات هتتزامن (أول 12)</p>
                  <ul className="text-xs font-bold space-y-1">
                    {recPreview.preview.valid.map((v) => (
                      <li key={v.txnId} className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5">
                        <span className="nk-num text-muted-foreground shrink-0" dir="ltr">#{v.seq}</span>
                        <span className="min-w-0 truncate">{v.op}{v.amount ? ` · ${Math.round(v.amount / 100)} ج` : ""} · {v.actor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {recPreview.preview.conflicts.length > 0 && (
                <div>
                  <p className="text-xs font-extrabold text-amber-700 mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    تعارضات محتاجة قرارك ({recPreview.preview.conflicts.length}) — افتراضي: تتخطى
                  </p>
                  <ul className="space-y-1.5">
                    {recPreview.preview.conflicts.map((c) => (
                      <li key={c.txnId} className="bg-card border border-amber-200 rounded-xl px-3 py-2.5 text-xs font-bold space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-extrabold">#{c.seq} · {c.opAr}{c.entityName ? ` — ${c.entityName}` : ""}</span>
                          <span className="nk-badge bg-amber-50 text-amber-700 border border-amber-200" style={{ borderRadius: 999, padding: "2px 8px" }}>{c.code}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <span className="bg-muted/60 rounded-lg px-2 py-1.5"><b>أوفلاين:</b> {c.offlineValue}</span>
                          <span className="bg-muted/60 rounded-lg px-2 py-1.5"><b>أونلاين:</b> {c.onlineValue}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{c.field} · {c.suggestion}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDecisions((d) => ({ ...d, [c.txnId]: "apply" }))}
                            className={cn("nk-btn sm", decisions[c.txnId] === "apply" ? "nk-brand-bg text-white" : "bg-card")}
                          >
                            طبّق اللي جاي من الطوارئ
                          </button>
                          <button
                            onClick={() => setDecisions((d) => ({ ...d, [c.txnId]: "skip" }))}
                            className={cn("nk-btn sm", decisions[c.txnId] === "skip" ? "bg-muted" : "bg-card")}
                          >
                            اسكبها
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {recPreview.preview.invalid.length > 0 && (
                <div>
                  <p className="text-xs font-extrabold text-rose-700 mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                    مرفوضة (سلامة/صيغة) — مش هتتزامن
                  </p>
                  <ul className="text-[11px] font-bold space-y-1">
                    {recPreview.preview.invalid.map((v, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 bg-card border border-rose-100 rounded-lg px-2.5 py-1.5">
                        <span className="nk-num text-muted-foreground" dir="ltr">{v.txnId.slice(0, 18)}…</span>
                        <span className="text-foreground/80">{v.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ===== نتيجة الاسترداد ===== */}
          {recResult && (
            <div className={cn(
              "rounded-2xl border p-4 space-y-2",
              recResult.conflicts > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50",
            )}>
              <p className="font-extrabold text-sm">{recResult.message}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="اتزامنت" value={recResult.imported} tone="ok" />
                <MiniStat label="متكررة" value={recResult.duplicates} tone="warn" />
                <MiniStat label="تعارضات" value={recResult.conflicts} tone="bad" />
                <MiniStat label="متخطاة" value={recResult.skipped} tone="warn" />
              </div>
              {recResult.conflictDetails?.length > 0 && (
                <ul className="text-[11px] font-bold text-amber-800 space-y-1 mt-1">
                  {recResult.conflictDetails.slice(0, 10).map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {c.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-[11px] font-bold text-muted-foreground leading-relaxed">
            الاسترداد محكوم: توقيع الرخصة بيتتحقق على السيرفر + الحزمة لازم تكون مسجّلة كمصدرة لسنترك + كل معاملة ETX بتتطابق بمجموع SHA-256 — والمتكرر بيتخطى نهائيًا، والتعارض بيتقرر منك. مفيش مسح ولا استبدال للداتا الحية أبدًا.
          </p>
        </div>
      </SectionCard>

      {/* ===== 3) الوضع الكلاسيكي (إكسل أسبوع) ===== */}
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none font-extrabold text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <FileSpreadsheet className="w-4 h-4" />
            الوضع الكلاسيكي: ملف إكسل لأسبوع (اختياري)
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <button
            onClick={() => { toast.info("جاري تجهيز ملف الأسبوع…"); window.location.href = "/api/emergency?export=1"; }}
            className="w-full border-2 border-[color:var(--c-primary)]/40 bg-card nk-brand-text font-extrabold rounded-2xl px-4 py-4 flex items-center justify-center gap-3 active:scale-[0.99] transition"
          >
            <FileSpreadsheet className="w-5 h-5" />
            نزّل ملف الأسبوع (إكسل)
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className={cn(
              "w-full rounded-2xl border-2 border-dashed p-4 text-center transition",
              file ? "border-[color:var(--c-primary)] bg-[color-mix(in_srgb,var(--c-primary)_6%,white)]" : "border-border bg-card hover:border-[color-mix(in_srgb,var(--c-primary)_40%,white)]",
            )}
          >
            <Upload className={cn("w-6 h-6 mx-auto mb-1.5", file ? "nk-brand-text" : "text-muted-foreground")} />
            {file ? (
              <p className="font-extrabold text-sm nk-brand-text">{file.name}</p>
            ) : (
              <p className="font-extrabold text-sm">ارفع ملف إكسل الأسبوع للمزامنة</p>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreview(null);
              setResult(null);
            }}
          />
          {file && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => analyze("preview")}
                disabled={busy !== null}
                className="flex-1 border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
              >
                {busy === "preview" ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                فحص الأول (معاينة)
              </button>
              <button
                onClick={() => analyze("commit")}
                disabled={busy !== null || (!preview && !file)}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 shadow flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
              >
                {busy === "commit" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                مزامنة العمليات الصحيحة
              </button>
            </div>
          )}
          {preview && (
            <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3">
              <p className="font-extrabold text-sm">{preview.message}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="العمليات" value={preview.totalRows} />
                <MiniStat label="جاهزة" value={preview.valid} tone="ok" />
                <MiniStat label="متكررة" value={preview.duplicates} tone="warn" />
                <MiniStat label="مراجعة" value={preview.conflicts} tone="bad" />
              </div>
              {preview.preview.conflicts.length > 0 && <ConflictList title="تحتاج مراجعة (مش هتتزامن)" tone="bad" items={preview.preview.conflicts} />}
            </div>
          )}
          {result && (
            <div className={cn(
              "rounded-2xl border p-4 space-y-2",
              result.conflicts > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50",
            )}>
              <p className="font-extrabold text-sm">{result.message}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="اتزامنت" value={result.imported} tone="ok" />
                <MiniStat label="متكررة" value={result.duplicates} tone="warn" />
                <MiniStat label="مراجعة" value={result.conflicts} tone="bad" />
              </div>
            </div>
          )}
        </div>
      </details>

      {/* ===== سجل المزامنات ===== */}
      <SectionCard title="سجل المزامنات والاستردادات" icon={<History className="w-4 h-4" />}>
        {!history ? (
          <Loading />
        ) : history.length === 0 ? (
          <EmptyState icon={<History className="w-8 h-8" />} title="لسه مفيش مزامنات" hint="أول ما ترفع ملف استرداد أو إكسل، هيظهر هنا." />
        ) : (
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold text-sm truncate">
                    {h.kind === "recovery" ? (
                      <span className="inline-flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5 nk-brand-text" /> {h.fileName}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5 text-muted-foreground" /> {h.fileName}</span>
                    )}
                  </p>
                  <p className="text-[11px] font-bold text-muted-foreground mt-0.5">
                    {h.importedByName} · {timeAgoAR(h.createdAt)} · {h.totalRows} معاملة
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold shrink-0">
                  <span className="nk-brand-bg-soft nk-brand-text rounded-full px-2 py-1">{h.imported} اتزامنت</span>
                  {h.duplicates > 0 && <span className="bg-muted text-muted-foreground rounded-full px-2 py-1">{h.duplicates} متكررة</span>}
                  {h.conflicts > 0 && <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-1">{h.conflicts} تعارض</span>}
                  {h.skipped > 0 && <span className="bg-muted text-muted-foreground rounded-full px-2 py-1">{h.skipped} متخطاة</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={cn(
      "rounded-xl border px-2 py-2",
      tone === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
      tone === "warn" ? "bg-muted border-border text-muted-foreground" :
      tone === "bad" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-card border-border",
    )}>
      <p className="nk-num text-lg font-extrabold leading-none">{value}</p>
      <p className="text-[10px] font-bold mt-1">{label}</p>
    </div>
  );
}

function ConflictList({ title, tone, items }: { title: string; tone: "warn" | "bad"; items: { emg: string; code: string; type: string; reason: string }[] }) {
  return (
    <div>
      <p className="text-xs font-extrabold mb-1.5 flex items-center gap-1.5">
        <AlertTriangle className={cn("w-3.5 h-3.5", tone === "warn" ? "text-amber-500" : "text-rose-500")} />
        {title}
      </p>
      <ul className="text-[11px] font-bold space-y-1">
        {items.map((d, i) => (
          <li key={i} className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5">
            <span className="nk-num text-muted-foreground" dir="ltr">{d.emg}</span>
            <span className="text-foreground/80">{d.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type PreviewData = {
  fileName: string; totalRows: number; valid: number; duplicates: number; conflicts: number;
  preview: {
    valid: { emg: string; code: string; type: string; group: string | null; book?: string | null; qty?: number | null; amount: number | null; method: string | null }[];
    duplicates: { emg: string; code: string; type: string; reason: string }[];
    conflicts: { emg: string; code: string; type: string; reason: string }[];
  };
  message: string;
};
