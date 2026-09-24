"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FlaskConical, Loader2, Trash2, RefreshCw, ScanLine, Printer, BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, sessionPhase, type SessionUser } from "./lib";
import { SectionCard, EmptyState } from "./shared";

/* ============================================================
   كارت وضع التجربة — للمدير بس:
   يجرب النظام كل يوم على بيانات وهمية (أكواد 99xxx)
   من غير ما يلمس الطلاب الحقيقيين، ويمسح كل أثر
   التجربة بزرار واحد.
============================================================ */

type DemoStatus = {
  ready: boolean;
  students: { code: string; name: string; balance: number }[];
  sessions: {
    id: string; subject: string; groupName: string; startTime: string; endTime: string;
    room: string | null; status: string; attendanceCount: number;
  }[];
};

export function DemoCard({ user, onGoScan }: { user: SessionUser; onGoScan: () => void }) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(() => {
    api<DemoStatus>("/api/demo", { silent: true }).then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setup() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/demo", { method: "POST" });
      toast.success(res.message);
      load();
    } catch { /* toast already shown */ } finally { setBusy(false); }
  }

  async function cleanup() {
    if (cleaning) return;
    const total = (status?.students.length ?? 0) + (status?.sessions.length ?? 0);
    if (!confirm(
      `هتمسح كل البيانات التجريبية (${total} عنصر) وحضورها وإيصالاتها وقيودها من اليومية.\nالطلاب الحقيقيين وحضورهم مش هتتلمس.\n\nمتأكد؟`,
    )) return;
    setCleaning(true);
    try {
      const res = await api<{ message: string }>("/api/demo?confirm=demo", { method: "DELETE" });
      toast.success(res.message);
      load();
    } catch { /* toast already shown */ } finally { setCleaning(false); }
  }

  return (
    <SectionCard
      title="وضع التجربة — جرب النظام كل يوم"
      icon={<FlaskConical className="w-4 h-4" />}
    >
      <div className="space-y-3.5">
        <p className="text-xs font-semibold text-muted-foreground leading-relaxed">
          بيانات وهمية معزولة عن الطلاب الحقيقيين: طلاب بأكواد تبدأ بـ 99، وحصص النهاردة جاهزة.
          جرب المسح والحضور والدفع وطباعة الإيصال براحتك — ولما تخلص دوس «امسح» وكل أثر التجربة يختفي.
        </p>

        {/* مش جاهز */}
        {!status?.ready ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5 text-center space-y-3">
            <p className="text-sm font-extrabold">لسه مفيش بيانات تجريبية</p>
            <p className="text-xs font-semibold text-muted-foreground">
              زرار واحد هيجهزلك: مدرس تجريبي + مجموعتين + 6 طلاب بأرصدة متنوعة + حصتين النهاردة (واحدة شغالة دلوقتي)
            </p>
            <button onClick={setup} disabled={busy}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-5 py-3 shadow inline-flex items-center justify-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <FlaskConical className="w-4.5 h-4.5" />}
              جهّز حصص وطلاب تجريبيين للنهاردة
            </button>
          </div>
        ) : (
          <>
            {/* الطلاب التجريبيين */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-extrabold text-muted-foreground">الطلاب التجريبيين — اكتب الكود في صفحة المسح وجرّب</h4>
                <span className="text-[10px] font-bold text-muted-foreground">أكواد 99xxx = تجريبي</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {status.students.map((s) => (
                  <button key={s.code} onClick={onGoScan}
                    className="rounded-xl border border-border bg-card p-2.5 text-start hover:shadow-md transition active:scale-[0.98]">
                    <div className="flex items-center justify-between gap-1">
                      <span className="nk-num font-extrabold text-base nk-brand-text" dir="ltr">{s.code}</span>
                      <ScanLine className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </div>
                    <span className="block text-[11px] font-bold text-muted-foreground truncate">{s.name}</span>
                    <span className={cn(
                      "block text-[11px] font-extrabold nk-num",
                      s.balance > 0 ? "text-emerald-700" : s.balance < 0 ? "text-rose-600" : "text-muted-foreground"
                    )} dir="ltr">
                      {s.balance > 0 ? `له ${fmt(s.balance)} ج` : s.balance < 0 ? `عليه ${fmt(-s.balance)} ج` : "رصيده صفر — جرّب الدفع"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* حصص النهاردة التجريبية */}
            <div>
              <h4 className="text-xs font-extrabold text-muted-foreground mb-2">حصص النهاردة التجريبية</h4>
              {status.sessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2.5 text-xs font-bold text-muted-foreground">
                  مفيش حصص تجريبية النهاردة — دوس «جهّز» فوق وهتتعمل على طول.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {status.sessions.map((s) => {
                    const phase = sessionPhase(s.startTime, s.endTime);
                    const live = phase === "now" && s.status !== "CLOSED";
                    return (
                      <button key={s.id} onClick={onGoScan}
                        className="w-full rounded-xl border bg-card px-3 py-2.5 flex items-center gap-2.5 text-start hover:shadow-md transition">
                        <span className={cn(
                          "nk-num shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold border",
                          live ? "nk-brand-bg text-white border-transparent" : "bg-card border-border"
                        )}>
                          {formatTime12(s.startTime)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-extrabold">{s.subject} — {s.groupName}{s.room ? ` · ${s.room}` : ""}</span>
                          <span className="block text-[10px] font-bold text-muted-foreground">{s.attendanceCount} حضر</span>
                        </span>
                        {live && (
                          <span className="shrink-0 text-[10px] font-extrabold nk-brand-text inline-flex items-center gap-1">
                            <BadgeCheck className="w-3.5 h-3.5" /> شغالة دلوقتي
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* أزرار */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={setup} disabled={busy || cleaning}
                className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow text-xs inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                جهّز / حدّث للنهاردة
              </button>
              <button onClick={cleanup} disabled={busy || cleaning}
                className="border-2 border-rose-200 bg-rose-50 text-rose-700 font-extrabold rounded-xl px-4 py-2.5 text-xs inline-flex items-center gap-1.5 hover:bg-rose-100 disabled:opacity-60">
                {cleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                امسح البيانات التجريبية
              </button>
              <button onClick={onGoScan}
                className="border-2 border-border bg-card font-extrabold rounded-xl px-4 py-2.5 text-xs inline-flex items-center gap-1.5 hover:bg-muted">
                <ScanLine className="w-4 h-4" /> ابدأ التجربة من المسح
              </button>
            </div>

            <p className="text-[11px] font-semibold text-muted-foreground leading-relaxed border-t border-border/60 pt-2.5">
              جرّب: امسح كود طالب معاه رصيد (هيتخصم ويتسجل حضور) · امسح كود رصيده صفر (هيطلب دفع — ادفع واطبع الإيصال) ·
              قفل الحصة وشوف اليومية · ولما تخلص امسح كل حاجة.
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}
