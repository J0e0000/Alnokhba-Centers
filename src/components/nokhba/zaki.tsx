"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Loader2, MapPin, Wrench, AlertTriangle, Info, Siren, RefreshCw, MessageCircleQuestion } from "lucide-react";
import { api } from "./lib";
import { cn } from "@/lib/utils";

/* ============================================================
   زكي — المساعد الذكي للنخبة (UI)
   ⚠️ مش شات بوت ولا AI — كل الإجابات حتمية من قواعد على داتا السنتر.
   بيجاوب: إيه اللي حصل؟ فين بالظبط؟ ليه اتعلم؟ تعمل إيه؟
============================================================ */

type Finding = {
  id: string; dimension: string; severity: "INFO" | "WARNING" | "CRITICAL";
  what: string; where: string; why: string; action: string;
  go?: { view: string; studentId?: string };
};

type ZakiData = {
  findings: Finding[];
  at: string;
  questions: { key: string; label: string }[];
};

type Answer = {
  key: string; title: string; body: string;
  items: { label: string; sub?: string; studentId?: string }[];
  go?: { view: string; studentId?: string };
};

const SEV_STYLE: Record<string, { chip: string; icon: React.ReactNode; label: string }> = {
  CRITICAL: { chip: "bg-rose-600 text-white", icon: <Siren className="w-3.5 h-3.5" />, label: "حرج" },
  WARNING: { chip: "bg-amber-500 text-white", icon: <AlertTriangle className="w-3.5 h-3.5" />, label: "يحتاج انتباه" },
  INFO: { chip: "bg-sky-600 text-white", icon: <Info className="w-3.5 h-3.5" />, label: "للمتابعة" },
};

export function ZakiAssistant() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ZakiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [qBusy, setQBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<ZakiData>("/api/zaki", { silent: true })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open && !data) load(); }, [open, data, load]);

  async function ask(key: string) {
    setQBusy(key);
    setAnswer(null);
    try {
      const a = await api<Answer>("/api/zaki", { method: "POST", body: { q: key } });
      setAnswer(a);
    } catch { /* silent */ } finally { setQBusy(null); }
  }

  function navigate(go?: { view: string; studentId?: string }) {
    if (!go) return;
    window.dispatchEvent(new CustomEvent("nk-navigate", { detail: { view: go.view } }));
    setOpen(false);
  }

  const topSev = data?.findings?.[0]?.severity ?? "INFO";
  const badge = topSev === "CRITICAL" ? "bg-rose-600" : topSev === "WARNING" ? "bg-amber-500" : "nk-brand-grad";
  const count = data?.findings?.length ?? 0;

  return (
    <>
      {/* الزرار العائم */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.6, type: "spring", stiffness: 260, damping: 18 }}
        onClick={() => setOpen(true)}
        aria-label="افتح زكي — المساعد الذكي"
        className={cn(
          "fixed bottom-[5.4rem] md:bottom-6 end-4 z-[70] rounded-full shadow-lg text-white",
          "w-13 h-13 md:w-14 md:h-14 p-3.5 flex items-center justify-center",
          badge,
        )}
      >
        <Sparkles className="w-6 h-6" />
        {count > 0 && (
          <span className="absolute -top-1 -end-1 min-w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-black grid place-items-center px-1 nk-num">
            {count}
          </span>
        )}
      </motion.button>

      {/* اللوحة */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="fixed inset-x-3 bottom-3 md:inset-x-auto md:end-6 md:bottom-24 md:w-[26rem] z-[80]"
          >
            <div className="nk-card rounded-3xl shadow-2xl border border-border overflow-hidden max-h-[76vh] flex flex-col">
              {/* هيدر زكي */}
              <div className="nk-brand-grad text-white p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-white/15 grid place-items-center shrink-0 backdrop-blur">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black leading-tight">زكي</p>
                  <p className="text-[11px] font-bold text-white/80">مساعدك الذكي — قواعد على داتا سنترك، من غير أي AI خارجي</p>
                </div>
                <button onClick={load} aria-label="تحديث" className="p-2 rounded-xl hover:bg-white/15">
                  <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                </button>
                <button onClick={() => setOpen(false)} aria-label="إغلاق" className="p-2 rounded-xl hover:bg-white/15">
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="overflow-y-auto nk-scroll p-4 space-y-3.5">
                {/* أسئلة جاهزة */}
                <div>
                  <p className="text-xs font-black text-muted-foreground flex items-center gap-1.5 mb-2">
                    <MessageCircleQuestion className="w-3.5 h-3.5" /> اسأل زكي
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(data?.questions ?? []).map((q) => (
                      <button
                        key={q.key}
                        onClick={() => ask(q.key)}
                        disabled={qBusy !== null}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition active:scale-[0.97]",
                          answer?.key === q.key
                            ? "nk-brand-bg text-white border-transparent"
                            : "bg-card border-border text-muted-foreground hover:bg-muted/60",
                        )}
                      >
                        {qBusy === q.key ? <Loader2 className="w-3 h-3 inline animate-spin" /> : q.label}
                      </button>
                    ))}
                    {!data && !loading && <p className="text-xs text-muted-foreground font-bold">جرب تحديث اللوحة.</p>}
                  </div>
                </div>

                {/* إجابة السؤال */}
                {answer && (
                  <div className="rounded-2xl border-2 nk-brand-border nk-brand-bg-soft p-3.5 space-y-2">
                    <p className="font-black text-sm">{answer.title}</p>
                    <p className="text-xs font-bold text-muted-foreground leading-relaxed">{answer.body}</p>
                    {answer.items.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {answer.items.slice(0, 8).map((it, i) => (
                          <button
                            key={i}
                            onClick={() => navigate(it.studentId ? { view: "students", studentId: it.studentId } : answer.go)}
                            className="w-full text-start rounded-xl bg-card border border-border px-3 py-2 hover:bg-muted/50 transition"
                          >
                            <span className="text-xs font-extrabold block truncate">{it.label}</span>
                            {it.sub && <span className="text-[10px] font-bold text-muted-foreground">{it.sub}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {answer.go && (
                      <button onClick={() => navigate(answer.go)} className="text-[11px] font-black nk-brand-text underline underline-offset-2">
                        افتح الشاشة المعنية ←
                      </button>
                    )}
                  </div>
                )}

                {/* الملاحظات */}
                <div>
                  <p className="text-xs font-black text-muted-foreground mb-2">
                    ملاحظات التحليل {count > 0 && <span className="nk-num">({count})</span>}
                  </p>
                  {loading && (
                    <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground font-bold text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" /> زكي بيحلل داتا السنتر…
                    </div>
                  )}
                  {!loading && count === 0 && (
                    <div className="rounded-2xl border border-border bg-muted/40 p-4 text-center">
                      <p className="font-extrabold text-sm">كل حاجة تمام ✌️</p>
                      <p className="text-xs font-bold text-muted-foreground mt-1">مفيش ملاحظات تستاهل الانتباه دلوقتي.</p>
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {data?.findings.map((f) => {
                      const sev = SEV_STYLE[f.severity];
                      return (
                        <div key={f.id + (f.where ?? "")} className="rounded-2xl border border-border bg-card p-3.5 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black inline-flex items-center gap-1", sev.chip)}>
                              {sev.icon} {sev.label}
                            </span>
                            <span className="text-[10px] font-extrabold text-muted-foreground">
                              {f.dimension === "FINANCIAL" ? "مالي" : f.dimension === "ACADEMIC" ? "أكاديمي" : "تشغيلي"}
                            </span>
                          </div>
                          <p className="font-extrabold text-sm leading-snug">{f.what}</p>
                          <p className="text-xs font-bold flex items-start gap-1.5 text-muted-foreground">
                            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                            <span><b className="text-foreground">فين:</b> {f.where}</span>
                          </p>
                          <p className="text-[11px] font-bold text-muted-foreground leading-relaxed">{f.why}</p>
                          <p className="text-[11px] font-extrabold flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
                            <Wrench className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{f.action}</span>
                          </p>
                          {f.go && (
                            <button onClick={() => navigate(f.go)} className="text-[11px] font-black nk-brand-text underline underline-offset-2">
                              خدني هناك ←
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
