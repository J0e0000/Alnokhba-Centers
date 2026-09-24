"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Users, Loader2, Send, CheckCircle2, Target, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, timeAgoAR, type SessionUser } from "./lib";
import { PageHeader, SectionCard, EmptyState, Loading } from "./shared";

type Announcement = {
  id: string; title: string; body: string;
  audienceType: string; audienceName: string;
  recipients: number; createdByName: string; createdAt: string;
};

type AudienceOption = { id: string; name: string };

type AnnouncementsData = {
  announcements: Announcement[];
  audienceOptions: { grades: AudienceOption[]; groups: AudienceOption[]; subjects: AudienceOption[] };
};

const AUDIENCE_TYPES = [
  { id: "ALL", label: "كل الطلاب" },
  { id: "GRADE", label: "مرحلة" },
  { id: "GROUP", label: "مجموعة" },
  { id: "SUBJECT", label: "مادة" },
] as const;

/** عرض الإعلانات — لو embedded (جوّه تاب الرسائل) من غير هيدر منفصل */
export function AnnouncementsView({ user, embedded }: { user: SessionUser; embedded?: boolean }) {
  const [data, setData] = useState<AnnouncementsData | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audienceType, setAudienceType] = useState<(typeof AUDIENCE_TYPES)[number]["id"]>("ALL");
  const [audienceId, setAudienceId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<AnnouncementsData>("/api/announcements").then(setData).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const options =
    audienceType === "GRADE" ? data?.audienceOptions.grades ?? [] :
    audienceType === "GROUP" ? data?.audienceOptions.groups ?? [] :
    audienceType === "SUBJECT" ? data?.audienceOptions.subjects ?? [] : [];

  async function publish() {
    if (title.trim().length < 3) { toast.error("اكتب عنوان واضح للإعلان."); return; }
    if (body.trim().length < 3) { toast.error("اكتب نص الإعلان."); return; }
    if (audienceType !== "ALL" && !audienceId) { toast.error(`اختار ${audienceType === "GRADE" ? "المرحلة" : audienceType === "GROUP" ? "المجموعة" : "المادة"}.`); return; }
    setBusy(true);
    try {
      const res = await api<{ recipients: number; message: string }>("/api/announcements", {
        method: "POST",
        body: { title: title.trim(), body: body.trim(), audienceType, audienceId: audienceType === "ALL" ? null : audienceId },
      });
      toast.success(res.message);
      setTitle("");
      setBody("");
      setAudienceType("ALL");
      setAudienceId("");
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  const examples = [
    "حصة التاريخ النهاردة هتبدأ 6:30 بدل 6:00.",
    "حصة الجغرافيا هتكون في القاعة 3.",
    "تنبيه: السنتر مغلق يوم الجمعة للصيانة.",
  ];

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="الإعلانات"
          subtitle="إعلان واحد → إشعار لكل طالب في الجمهور المحدد تلقائيًا"
        />
      )}

      {/* ===== create form ===== */}
      <SectionCard title="إعلان جديد" icon={<Megaphone className="w-4 h-4" />}>
        <div className="space-y-3.5">
          <div>
            <label className="text-sm font-bold mb-1.5 block">العنوان</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              placeholder="مثلاً: تغيير موعد حصة التاريخ"
              className="w-full h-12 rounded-xl border-2 border-input bg-card px-3.5 font-bold text-sm focus-visible:outline-none focus-visible:border-[color:var(--c-primary)]"
              disabled={busy}
            />
          </div>

          <div>
            <label className="text-sm font-bold mb-1.5 block">نص الإعلان</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 600))}
              placeholder="اكتب الإعلان ببساطة — الطالب هيقرأه على موبايله"
              className="w-full min-h-[90px] rounded-xl border-2 border-input bg-card px-3.5 py-2.5 font-semibold text-sm resize-none focus-visible:outline-none focus-visible:border-[color:var(--c-primary)]"
              disabled={busy}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setBody(ex)}
                  className="text-[10px] font-bold text-muted-foreground bg-muted/60 border border-border rounded-full px-2.5 py-1 hover:bg-muted transition"
                  disabled={busy}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-bold mb-1.5 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-muted-foreground" /> الجمهور
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {AUDIENCE_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setAudienceType(t.id); setAudienceId(""); }}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-xs font-extrabold border transition active:scale-[0.98]",
                    audienceType === t.id
                      ? "nk-brand-bg text-white border-transparent shadow"
                      : "bg-card border-border text-muted-foreground",
                  )}
                  disabled={busy}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {options.length > 0 && (
              <select
                value={audienceId}
                onChange={(e) => setAudienceId(e.target.value)}
                className="w-full h-12 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm focus-visible:outline-none focus-visible:border-[color:var(--c-primary)]"
                disabled={busy}
              >
                <option value="">— اختار —</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </div>

          <button
            onClick={publish}
            disabled={busy}
            className="w-full nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            نشر الإعلان
          </button>
          <p className="text-[11px] font-bold text-muted-foreground leading-relaxed">
            الإعلان بيظهر للطالب في تاب «الرسايل» في البورتال (/portal) بنفس شكله هنا — ولو فعّل تنبيهات الموبايل بيوصله Push كمان. الطلاب اللي مش في الجمهور مش بيوصّلهم خالص.
          </p>
        </div>
      </SectionCard>

      {/* ===== history ===== */}
      <SectionCard title="الإعلانات المنشورة" icon={<CheckCircle2 className="w-4 h-4" />}>
        {!data ? (
          <Loading />
        ) : data.announcements.length === 0 ? (
          <EmptyState icon={<Megaphone className="w-8 h-8" />} title="لسه مفيش إعلانات" hint="انشر أول إعلان من فوق." />
        ) : (
          <ul className="divide-y">
            {data.announcements.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-sm">{a.title}</p>
                    <p className="text-xs font-semibold text-muted-foreground mt-1 leading-relaxed line-clamp-2">{a.body}</p>
                    <p className="text-[10px] font-bold text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <span className="nk-brand-bg-soft nk-brand-text rounded-full px-2 py-0.5">{a.audienceName}</span>
                      <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {a.recipients} طالب</span>
                      <span>· {a.createdByName}</span>
                      <span>· {timeAgoAR(a.createdAt)}</span>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
