"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, ClipboardCheck, UserPlus, Scale, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/* ============================================================
   جرس إشعارات الموظفين (مدير/أدمن/استقبال)
   ------------------------------------------------------------
   - بولينج كل 15 ثانية + فورًا مع حدث nk-staff-notifs
     (طلب موافقة جديد بيوصله في ثانية من إنشائه).
   - البادج بيبان عدد غير المقروء.
   - الضغط على الإشعار بيوصل للشاشة المطلوبة.
============================================================ */

type StaffNotif = {
  id: string;
  type: "APPROVAL_REQUEST" | "APPROVAL_DECIDED" | "SIGNUP_REQUEST" | "SYSTEM" | string;
  title: string;
  body: string;
  link: string | null;
  refId: string | null;
  read: boolean;
  createdAt: string;
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  APPROVAL_REQUEST: <ClipboardCheck className="w-4 h-4" />,
  APPROVAL_DECIDED: <Scale className="w-4 h-4" />,
  SIGNUP_REQUEST: <UserPlus className="w-4 h-4" />,
  SYSTEM: <Bell className="w-4 h-4" />,
};

export function StaffNotificationsBell({ variant = "center" }: { variant?: "center" | "admin" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StaffNotif[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const primed = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ unread: number; notifications: StaffNotif[] }>("/api/notifications/staff", { silent: true });
      setItems(d.notifications);
      setUnread(d.unread);
      primed.current = true;
    } catch { /* silent */ }
  }, []);

  // بولينج سريع: 15 ثانية + فورًا مع أي حدث جديد
  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    const onFocus = () => void load();
    const onEvt = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("nk-staff-notifs", onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("nk-staff-notifs", onEvt);
    };
  }, [load]);

  async function markAll() {
    try {
      await api("/api/notifications/staff", { method: "POST", body: { action: "readAll" }, silent: true });
      setItems((list) => list.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* silent */ }
  }

  async function markOne(id: string) {
    try {
      await api("/api/notifications/staff", { method: "POST", body: { action: "read", id }, silent: true });
      setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* silent */ }
  }

  function onPick(n: StaffNotif) {
    if (!n.read) void markOne(n.id);
    setOpen(false);
    if (!n.link) return;
    // center: "approvals" | "payments" — admin: "requests" | "centers" ...
    if (variant === "admin") {
      window.dispatchEvent(new CustomEvent("nk-navigate-admin", { detail: { view: n.link } }));
    } else {
      window.dispatchEvent(new CustomEvent("nk-navigate", { detail: { view: n.link } }));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={unread > 0 ? `الإشعارات — ${unread} غير مقروء` : "الإشعارات"}
          className="relative rounded-xl h-10 w-10 border-border bg-card"
          data-tour="staff-bell"
        >
          <Bell className="w-4.5 h-4.5" />
          {unread > 0 && (
            <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] rounded-full bg-rose-600 text-white text-[10px] font-extrabold grid place-items-center px-1 nk-anim-tab">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[22rem] p-0 rounded-2xl border-border shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 rounded-t-2xl">
          <h3 className="text-sm font-extrabold flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-muted-foreground" /> الإشعارات
            {unread > 0 && <span className="text-[10px] font-bold text-rose-600">({unread} جديد)</span>}
          </h3>
          {unread > 0 && (
            <button onClick={markAll} className="text-[11px] font-extrabold nk-brand-text hover:underline flex items-center gap-1">
              <CheckCheck className="w-3.5 h-3.5" /> قراءة الكل
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto nk-scroll">
          {!primed.current ? (
            <div className="py-10 grid place-items-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-xs font-bold text-muted-foreground">
              مفيش إشعارات لسه — طلبات الموافقة وطلبات الانضمام هتظهر هنا فورًا.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => onPick(n)}
                    className={cn(
                      "w-full text-start px-4 py-3 flex items-start gap-3 transition hover:bg-muted/50",
                      !n.read && "bg-sky-50/60 dark:bg-sky-950/60",
                    )}
                  >
                    <span className={cn(
                      "w-8 h-8 rounded-xl grid place-items-center shrink-0",
                      !n.read ? "nk-brand-grad text-white" : "bg-muted text-muted-foreground",
                    )}>
                      {TYPE_ICON[n.type] ?? TYPE_ICON.SYSTEM}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-extrabold truncate">{n.title}</span>
                      <span className="block text-[11px] text-muted-foreground font-semibold leading-relaxed line-clamp-2">{n.body}</span>
                      <span className="block text-[10px] text-muted-foreground/80 font-bold mt-0.5">
                        {new Date(n.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-1.5" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
