"use client";

import { useEffect, useRef, useState } from "react";
import { Search, CornerDownLeft, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, normalizeDigits, type SessionUser } from "./lib";
import { NAV_LABELS } from "./shell";
import type { ViewId } from "./shell";

type PaletteItem = {
  kind: "nav" | "student";
  id: string;
  label: string;
  sub?: string;
  icon?: string;
  action: () => void;
};

/**
 * CommandPalette — Ctrl+K / ⌘K من أي مكان:
 * - تنقّل فوري لأي صفحة (الحضور/الدفع/الطلاب/...)
 * - بحث لايف عن طالب بالاسم/الكود → فتح ملفه
 */
export function CommandPalette({ user, setView, onOpenStudent }: {
  user: SessionUser;
  setView: (v: ViewId) => void;
  onOpenStudent: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [students, setStudents] = useState<{ id: string; code: string; name: string; grade: string | null }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const navIds: ViewId[] = user.role === "MANAGER"
    ? ["home", "scan", "payments", "students", "approvals", "schedule", "groups", "books", "messages", "accounting", "reports", "settings"]
    : ["home", "scan", "payments", "students", "schedule", "books", "messages"];

  // فتح/قفل بـ Ctrl+K أو ⌘K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // reset عند الفتح (بعد تيك — من غير cascading render)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setQ("");
      setStudents([]);
      setHi(0);
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  // بحث لايف عن الطلاب (debounce)
  useEffect(() => {
    const raw = q.trim();
    const t = setTimeout(async () => {
      if (!raw || /^\d$/.test(raw)) { setStudents([]); return; }
      try {
        const d = await api<{ students: typeof students }>(`/api/lookup?q=${encodeURIComponent(raw)}`, { silent: true });
        setStudents(d.students.slice(0, 5));
      } catch { /* silent */ }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const navItems: PaletteItem[] = navIds.map((v) => ({
    kind: "nav",
    id: `nav-${v}`,
    label: NAV_LABELS[v],
    sub: "صفحة",
    action: () => { setView(v); setOpen(false); },
  }));

  const studentItems: PaletteItem[] = students.map((s) => ({
    kind: "student",
    id: `st-${s.id}`,
    label: s.name,
    sub: `طالب · ${s.grade ?? ""} · ${s.code}`,
    action: () => { onOpenStudent(s.id); setOpen(false); },
  }));

  const filteredNav = q.trim()
    ? navItems.filter((n) => n.label.includes(q.trim()) || q.trim().length <= 1)
    : navItems.slice(0, 6);

  const items = [...studentItems, ...filteredNav];

  // تنفيذ بالكيبورد
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % Math.max(items.length, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h <= 0 ? items.length - 1 : h - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      items[hi]?.action();
    }
  }

  // scroll العنصر المحدد للمنظر
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div
        className="bg-card w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden nk-animate-pop border border-border"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="بحث سريع"
      >
        {/* خانة البحث */}
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(normalizeDigits(e.target.value)); setHi(0); }}
            onKeyDown={onKeyDown}
            placeholder="روح لصفحة... أو ابحث عن طالب (الاسم/الكود)"
            className="flex-1 h-14 text-base font-bold focus-visible:outline-none bg-transparent"
            dir="auto"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-bold text-muted-foreground border border-border rounded-md px-1.5 py-1 shrink-0" dir="ltr">Esc</kbd>
        </div>

        {/* النتائج */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto nk-scroll">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm font-bold text-muted-foreground text-center">
              {q.trim() ? "مفيش نتائج — جرب اسم أقصر أو اسم الصفحة." : "اكتب حاجة..."}
            </p>
          ) : (
            <>
              {studentItems.length > 0 && (
                <p className="px-4 pt-3 pb-1 text-[10px] font-extrabold text-muted-foreground tracking-wide">طلاب</p>
              )}
              {items.map((it, i) => (
                <button
                  key={it.id}
                  data-idx={i}
                  onClick={it.action}
                  onMouseEnter={() => setHi(i)}
                  className={cn(
                    "w-full px-4 py-3 flex items-center gap-3 text-start border-b last:border-0 transition",
                    i === hi ? "bg-[color-mix(in_srgb,var(--c-primary)_8%,white)]" : "bg-card"
                  )}
                >
                  <span className={cn(
                    "w-9 h-9 rounded-xl grid place-items-center font-extrabold text-sm shrink-0",
                    it.kind === "student" ? "nk-brand-bg-soft nk-brand-text" : "bg-muted text-muted-foreground"
                  )}>
                    {it.kind === "student" ? it.label.trim()[0] : it.label.trim()[0]}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-extrabold text-sm truncate">{it.label}</span>
                    {it.sub && <span className="block text-[11px] text-muted-foreground font-semibold truncate">{it.sub}</span>}
                  </span>
                  {i === hi && <CornerDownLeft className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
              ))}
              {filteredNav.length > 0 && studentItems.length > 0 && (
                <p className="px-4 pt-3 pb-1 text-[10px] font-extrabold text-muted-foreground tracking-wide">صفحات</p>
              )}
            </>
          )}
        </div>

        {/* تلميح */}
        <div className="px-4 py-2.5 bg-muted/50 border-t border-border flex items-center gap-4 text-[10px] font-bold text-muted-foreground">
          <span className="flex items-center gap-1"><ArrowUpDown className="w-3 h-3" /> تنقّل</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> فتح</span>
          <span className="ms-auto" dir="ltr">Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
