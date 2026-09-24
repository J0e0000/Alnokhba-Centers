"use client";

/* Notifications panel — contextual communication display (spec §28) */

import { useCallback, useEffect, useState } from "react";
import { Bell, X, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acaApi, fmtDate } from "./client";
import { cn } from "@/lib/utils";

type NotifRow = { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string };

export function NotificationsPanel({ onClose, onRead }: { onClose: () => void; onRead: () => void }) {
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await acaApi<{ notifications: NotifRow[] }>("/api/academia/notifications");
      setRows(d.notifications);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markAll = async () => {
    await acaApi("/api/academia/notifications", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    setRows((m) => m.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })));
    onRead();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-16" onClick={onClose} role="dialog" aria-label="الإشعارات">
      <div className="w-full max-w-md rounded-3xl bg-background border shadow-xl max-h-[70dvh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-black flex items-center gap-2"><Bell className="w-5 h-5" /> الإشعارات</h3>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="rounded-full text-xs font-bold" onClick={markAll}>
              <CheckCheck className="w-4 h-4" /> تعليم الكل
            </Button>
            <Button size="icon" variant="ghost" className="rounded-full" onClick={onClose} aria-label="قفل">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        <div className="overflow-y-auto p-3 space-y-1.5">
          {loading && <p className="text-center text-sm text-muted-foreground py-6">جاري التحميل…</p>}
          {!loading && rows.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">مفيش إشعارات</p>}
          {rows.map((n) => (
            <div key={n.id} className={cn("rounded-2xl border p-3", n.readAt ? "border-border opacity-70" : "nk-brand-border bg-[color-mix(in_srgb,var(--c-primary)_5%,white)] dark:bg-white/5")}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-extrabold text-sm">{n.title}</p>
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(n.createdAt.slice(0, 10))}</span>
              </div>
              <p className="text-xs mt-0.5 leading-relaxed">{n.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
