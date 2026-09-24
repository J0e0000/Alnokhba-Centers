"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageSquareText, Loader2, Plus, Send, SkipForward, XCircle,
  RotateCcw, Copy, Check, StopCircle, Users, AlertTriangle, RefreshCw, CheckCheck,
} from "lucide-react";
import { api, type SessionUser } from "./lib";
import { PageHeader, EmptyState, Loading } from "./shared";
import { openWhatsAppHandoff } from "./wa";
import { AnnouncementsView } from "./announcements";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ============================================================
   تاب «الرسائل» — كل تحكم السنتر في اللي الطالب يشوفه + الواتساب:
   - إعلانات البورتال (مدير + استقبال): بتنزل للطالب فورًا بنفس شكلها
   - طابور رسائل واتساب لولياء الأمور
============================================================ */

type MessagesSection = "portal" | "whatsapp";

export function MessagesView({ user }: { user: SessionUser }) {
  const [section, setSection] = useState<MessagesSection>("portal");

  const chips: { id: MessagesSection; label: string; icon: string }[] = [
    { id: "portal", label: "إعلانات البورتال", icon: "📢" },
    { id: "whatsapp", label: "رسائل واتساب", icon: "💬" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="الرسائل"
        subtitle="إعلانات بورتال الطالب + رسائل الواتساب — كله من تاب واحدة"
      />

      {/* قسمين — شيبس */}
      <div className="flex gap-2 p-1.5 rounded-2xl border border-border bg-card w-fit max-w-full overflow-x-auto nk-scroll">
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => setSection(c.id)}
            className={cn(
              "rounded-xl px-4 py-2.5 text-sm font-extrabold whitespace-nowrap transition active:scale-[0.98]",
              section === c.id ? "nk-brand-bg text-white shadow" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="me-1">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      {section === "portal"
        ? <AnnouncementsView user={user} embedded />
        : <MessageQueueView user={user} embedded />}
    </div>
  );
}

/* ============================================================
   طابور الرسائل — تسليم واتساب يدوي واحد-واحد:
   - رسالة لرسالة، كل تسليم بضغطة صريحة من الموظف
   - «تم فتح واتساب» ≠ «تم الإرسال» — التأكيد بيتم من الموظف
   - التقدّم محفوظ في السيرفر — refresh بيكمل من حيث توقفت
   - استراحة أمان بعد 100 تسليم في الجلسة الواحدة
============================================================ */

type QueueItem = {
  id: string;
  recipientName: string;
  recipientPhone: string;
  status: "QUEUED" | "SENDING" | "SENT" | "FAILED" | "SKIPPED" | "CANCELLED";
  attempts: number;
  handoffCount: number;
  lastError: string | null;
  messageText: string;
  createdAt: string;
};

type QueueData = {
  batch: { batchId: string; batchLabel: string } | null;
  stats: {
    total: number; queued: number; sending: number; sent: number;
    failed: number; skipped: number; cancelled: number;
  } | null;
  current: {
    id: string; recipientName: string; recipientPhone: string;
    templateKey: string; messageText: string; status: string;
    handoffCount: number; waUrl: string;
  } | null;
  items: QueueItem[];
};

const STATUS_LABEL: Record<QueueItem["status"], string> = {
  QUEUED: "في الانتظار",
  SENDING: "تم فتح واتساب",
  SENT: "تم الإرسال ✓",
  FAILED: "فشل",
  SKIPPED: "متخطاة",
  CANCELLED: "ملغاة",
};

const STATUS_STYLE: Record<QueueItem["status"], string> = {
  QUEUED: "bg-muted text-muted-foreground",
  SENDING: "bg-amber-100 text-amber-800",
  SENT: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-red-50 text-red-400",
};

const HANDOFF_BREAK = 100; // استراحة أمان بعد 100 تسليم

export function MessageQueueView({ user, embedded }: { user: SessionUser; embedded?: boolean }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [handoffs, setHandoffs] = useState(0); // تسليمات هذه الجلسة
  const [paused, setPaused] = useState(false); // استراحة الـ 100
  const [createOpen, setCreateOpen] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<QueueData>("/api/queue", { silent: true });
      setData(d);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    return () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); };
  }, [load]);

  async function act(action: string, itemId?: string, error?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/queue", { method: "PATCH", body: { action, itemId, error } });
      await load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  /** فتح واتساب للرسالة الحالية — تسليم واحد بضغطة واحدة */
  async function openCurrent() {
    if (!data?.current || busy) return;
    const item = data.current;
    setBusy(true);
    try {
      await api("/api/queue", { method: "PATCH", body: { action: "open", itemId: item.id } });
      const didOpen = openWhatsAppHandoff(item.waUrl);
      if (didOpen) {
        toast.success(`فتحنا محادثة واتساب مع ${item.recipientName} — راجع الرسالة وابعتها.`, { duration: 4000 });
        const next = handoffs + 1;
        setHandoffs(next);
        if (next >= HANDOFF_BREAK) setPaused(true);
      } else {
        await navigator.clipboard.writeText(item.messageText).catch(() => {});
        toast.error("المتصفح قفل النافذة — الرسالة اتمنسخت، الصقها بنفسك.", { duration: 6000 });
      }
      await load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function copyCurrent() {
    if (!data?.current) return;
    await navigator.clipboard.writeText(data.current.messageText).catch(() => {});
    toast.success("اتنسخت الرسالة — الصقها في واتساب.");
  }

  const stats = data?.stats;
  const progress = stats && stats.total > 0
    ? Math.round(((stats.sent + stats.sending + stats.skipped + stats.failed + stats.cancelled) / stats.total) * 100)
    : 0;

  return (
    <div className="space-y-5">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-extrabold text-base">طابور رسائل الواتساب</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              رسائل واتساب لولياء الأمور — واحدة واحدة بضغطتك، والتقدّم محفوظ حتى لو قفلت الصفحة
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground px-2.5 py-2 rounded-lg disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> تحديث
            </button>
            <button onClick={() => setCreateOpen(true)}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 text-sm inline-flex items-center gap-2 shadow disabled:opacity-60">
              <Plus className="w-4 h-4" /> دفعة جديدة
            </button>
          </div>
        </div>
      ) : (
        <PageHeader
          title="طابور الرسائل"
          subtitle="رسائل واتساب لولياء الأمور — واحدة واحدة بضغطتك، والتقدّم محفوظ حتى لو قفلت الصفحة"
          action={
            <div className="flex items-center gap-2">
              <button onClick={load} disabled={loading}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground px-2.5 py-2 rounded-lg disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> تحديث
              </button>
              <button onClick={() => setCreateOpen(true)}
                className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 text-sm inline-flex items-center gap-2 shadow disabled:opacity-60">
                <Plus className="w-4 h-4" /> دفعة جديدة
              </button>
            </div>
          }
        />
      )}

      {loading && !data ? (
        <Loading label="جاري تحميل الطابور..." />
      ) : !data?.batch ? (
        <EmptyState
          icon={<MessageSquareText className="w-10 h-10" />}
          title="مفيش طابور رسائل لسه"
          hint="اعمل دفعة جديدة: تنبيه رصيد لكل اللي عليهم فلوس، أو رسالة لمجموعة، أو حملة عامة — والنظام هيجهّز الرسايل واحدة واحدة تفتحها في واتساب بنفسك."
          action={
            <button onClick={() => setCreateOpen(true)}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 text-sm inline-flex items-center gap-2 shadow">
              <Plus className="w-4 h-4" /> اعمل أول دفعة
            </button>
          }
        />
      ) : (
        <>
          {/* ===== بطاقة الدفعة + التقدّم ===== */}
          <section className="nk-glass rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-extrabold text-base">{data.batch.batchLabel}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  تسليم يدوي واحد-واحد — «تم فتح واتساب» معناها المحادثة اتفتحت، و«تم الإرسال» بتأكيدك انت
                </p>
              </div>
              <div className="flex items-center gap-2">
                {stats && stats.failed > 0 && (
                  <button onClick={() => act("retry-failed")} disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-100 text-amber-800 rounded-lg px-3 py-2 hover:bg-amber-200 disabled:opacity-50">
                    <RotateCcw className="w-3.5 h-3.5" /> إعادة إرسال الفاشل ({stats.failed})
                  </button>
                )}
                {(stats?.queued ?? 0) + (stats?.sending ?? 0) > 0 && (
                  <button onClick={() => { if (confirm("هتلغي كل الرسايل اللي لسه متبعتتش في الطابور — متأكد؟")) act("stop"); }} disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs font-bold bg-red-50 text-red-600 rounded-lg px-3 py-2 hover:bg-red-100 disabled:opacity-50">
                    <StopCircle className="w-3.5 h-3.5" /> إيقاف الطابور
                  </button>
                )}
              </div>
            </div>

            {stats && (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {([
                    ["الكل", stats.total, "text-foreground"],
                    ["انتظار", stats.queued, "text-muted-foreground"],
                    ["فتح واتساب", stats.sending, "text-amber-600"],
                    ["مرسلة", stats.sent, "text-emerald-600"],
                    ["فاشلة", stats.failed, "text-red-600"],
                    ["متخطاة", stats.skipped, "text-slate-500"],
                  ] as const).map(([label, value, cls]) => (
                    <div key={label} className="rounded-xl border border-border bg-card/70 p-2.5 text-center">
                      <div className={`text-lg font-extrabold ${cls}`}>{value}</div>
                      <div className="text-[10px] font-bold text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between text-[11px] font-bold text-muted-foreground mb-1">
                    <span>التقدّم</span><span>{progress}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full nk-brand-bg transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </>
            )}
          </section>

          {/* ===== استراحة الأمان بعد 100 ===== */}
          {paused && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <p className="text-sm font-bold text-amber-800">
                  فتحت {HANDOFF_BREAK} محادثة في الجلسة دي — استراحة أمان عشان متتحظرش من واتساب.
                </p>
              </div>
              <button onClick={() => setPaused(false)}
                className="shrink-0 bg-amber-700 text-white text-xs font-extrabold rounded-lg px-3 py-2 hover:bg-amber-800">
                استكمال
              </button>
            </div>
          )}

          {/* ===== الرسالة الحالية ===== */}
          {data.current && data.current.status === "QUEUED" && !paused ? (
            <section className="rounded-2xl border-2 border-dashed border-[var(--c-primary)]/40 bg-card/80 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold text-[var(--c-primary)]">الرسالة الحالية</span>
                <span className="text-xs text-muted-foreground">
                  فاضل {stats?.queued ?? 0} في الانتظار
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="font-extrabold">{data.current.recipientName}</p>
                <p dir="ltr" className="text-sm text-muted-foreground font-semibold">{data.current.recipientPhone}</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3 text-sm leading-relaxed max-h-40 overflow-y-auto" aria-label="نص الرسالة">
                {data.current.messageText}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={openCurrent} disabled={busy}
                  className="bg-[#25D366] text-white font-extrabold rounded-xl px-4 py-2.5 text-sm inline-flex items-center gap-2 shadow hover:brightness-95 disabled:opacity-60">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  فتح واتساب وإرسالها
                </button>
                <button onClick={copyCurrent}
                  className="inline-flex items-center gap-1.5 text-sm font-bold border border-border rounded-xl px-3.5 py-2.5 hover:bg-muted/60">
                  <Copy className="w-4 h-4" /> نسخ الرسالة
                </button>
                <button onClick={() => act("skip", data.current!.id)} disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm font-bold border border-border rounded-xl px-3.5 py-2.5 hover:bg-muted/60 disabled:opacity-60">
                  <SkipForward className="w-4 h-4" /> تخطي
                </button>
                <button onClick={() => act("fail", data.current!.id, "تعليم يدوي: مفيش رد/رقم غلط")} disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-red-600 border border-red-200 rounded-xl px-3.5 py-2.5 hover:bg-red-50 disabled:opacity-60">
                  <XCircle className="w-4 h-4" /> الرقم ده فشل
                </button>
              </div>
            </section>
          ) : (stats?.queued ?? 0) === 0 && (stats?.sending ?? 0) > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm font-bold text-amber-800">
              خلصت التسليمات — فاضل تأكيد {stats!.sending} رسالة «تم فتح واتساب» من القائمة تحت (دوس ✓ لو بعتها فعلًا).
            </div>
          ) : (stats?.queued ?? 0) === 0 && (stats?.sending ?? 0) === 0 && (stats?.total ?? 0) > 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm font-bold text-emerald-700">
              الدفعة خلصت تمامًا — مفيش رسايل في الانتظار. تعمل دفعة جديدة؟
            </div>
          ) : null}

          {/* ===== قائمة الرسايل ===== */}
          <section className="nk-glass rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-extrabold text-sm">الرسايل ({data.items.length})</h3>
              <span className="text-[11px] text-muted-foreground font-bold">أول 200 رسالة</span>
            </div>
            <div className="max-h-[26rem] overflow-y-auto divide-y divide-border">
              {data.items.map((it) => (
                <QueueRow key={it.id} item={it} busy={busy} act={act} />
              ))}
            </div>
          </section>
        </>
      )}

      <CreateBatchDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} user={user} />
    </div>
  );
}

function QueueRow({ item, busy, act }: {
  item: QueueItem;
  busy: boolean;
  act: (action: string, itemId?: string, error?: string) => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-bold text-sm truncate">{item.recipientName}</span>
          <span dir="ltr" className="text-[11px] text-muted-foreground font-semibold">{item.recipientPhone}</span>
          <span className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 ${STATUS_STYLE[item.status]}`}>
            {STATUS_LABEL[item.status]}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.messageText.split("\n")[0]}</p>
        {item.lastError && <p className="text-[11px] text-red-600 mt-0.5">{item.lastError}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {item.status === "SENDING" && (
          <>
            <button title="تأكيد: بعتها فعلًا في واتساب" disabled={busy}
              onClick={() => act("confirm-sent", item.id)}
              className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-emerald-100 text-emerald-700 rounded-lg px-2.5 py-1.5 hover:bg-emerald-200 disabled:opacity-50">
              <CheckCheck className="w-3.5 h-3.5" /> تم الإرسال
            </button>
            <button title="الرقم غلط / مفيش رد" disabled={busy}
              onClick={() => act("fail", item.id, "أكدها الموظف: فشل التسليم")}
              className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-red-50 text-red-600 rounded-lg px-2.5 py-1.5 hover:bg-red-100 disabled:opacity-50">
              <XCircle className="w-3.5 h-3.5" /> فشل
            </button>
          </>
        )}
        {item.status !== "SENDING" && item.status !== "SENT" && (
          <button title="أعدها للانتظار" disabled={busy}
            onClick={() => act("retry-item", item.id)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground rounded-lg px-2 py-1.5 disabled:opacity-50">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

type GroupInfo = { id: string; name: string; subject: string; grade: string };

function CreateBatchDialog({ open, onClose, onCreated, user }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  user: SessionUser;
}) {
  const [source, setSource] = useState<"low_balance" | "group" | "all">("low_balance");
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ groups: GroupInfo[] }>("/api/academics", { silent: true })
      .then((d) => setGroups(d.groups ?? []))
      .catch(() => {});
  }, [open]);

  async function create() {
    if (busy) return;
    if (source === "group" && !groupId) {
      toast.error("اختار المجموعة الأول.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ created: number; deduped: number; invalidCount: number; batchLabel: string }>("/api/queue", {
        method: "POST",
        body: { source, groupId: groupId || undefined, customTitle: title.trim() || undefined },
      });
      const parts = [`اتعمل طابور بـ ${res.created} رسالة`];
      if (res.deduped > 0) parts.push(`${res.deduped} اتجاوزوا (اتبعتوا قبل كده الشهر ده)`);
      if (res.invalidCount > 0) parts.push(`${res.invalidCount} رقم مش صحيح اتفلتر`);
      toast.success(parts.join(" — "), { duration: 6000 });
      onCreated();
      onClose();
      setTitle("");
      setGroupId("");
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" /> دفعة رسائل جديدة
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-bold">المرسل إليهم</label>
            <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low_balance">اللي عليهم فلوس (رصيد سالب)</SelectItem>
                <SelectItem value="group">مجموعة محددة</SelectItem>
                <SelectItem value="all">كل الطلاب المسجلين</SelectItem>
              </SelectContent>
            </Select>
            {source === "low_balance" && (
              <p className="text-[11px] text-muted-foreground font-semibold">
                لازم تكون مفعّلة «تنبيهات الرصيد» من الإعدادات، والرسالة بتتلخص شهريًا لكل طالب
              </p>
            )}
          </div>

          {source === "group" && (
            <div className="space-y-1.5">
              <label className="text-sm font-bold">المجموعة</label>
              <Select value={groupId || undefined} onValueChange={setGroupId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="اختار المجموعة" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.grade} — {g.subject} ({g.name})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="batch-title" className="text-sm font-bold">اسم الدفعة (اختياري)</label>
            <input id="batch-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: تنبيه امتحانات الشهر"
              className="flex h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>

          <div className="rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground font-semibold">
            التسليم يدوي: النظام هيجهّز الرسايل واحدة واحدة، وانت اللي بتفتح كل محادثة واتساب بنفسك وتابعها.
            مفيش إرسال أوتوماتيك — ودي الصراحة الكاملة.
          </div>

          <button onClick={create} disabled={busy}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 text-sm w-full inline-flex items-center justify-center gap-2 shadow disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            إنشاء الطابور
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
