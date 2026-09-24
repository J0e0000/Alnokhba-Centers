"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, X, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, normalizeDigits } from "./lib";

export type StudentSuggestion = {
  id: string; code: string; name: string; grade: string | null;
  status?: string; subjects?: string[]; phone?: string | null;
};

/**
 * Live student search bar — suggestions dropdown while typing (name / code / phone),
 * keyboard navigation (↑ ↓ Enter Esc), click-outside close. Works like any modern search bar.
 *
 * التصميم: بار بارز وواضح — ارتفاع كبير، حدود 2px بتتوسع بلون السنتر عند الكتابة،
 * زرار مسح (X)، spinner أثناء البحث، ونتائج بمساحات لمس مريحة على الموبايل.
 */
export function StudentSearchBar({
  value, onChange, onPick, placeholder, autoFocus, disabled, className, inputCls: inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: StudentSuggestion) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  inputCls?: string;
}) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<StudentSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hi, setHi] = useState(-1); // highlighted row (-1 = none)
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastQueryRef = useRef("");

  // debounced live lookup
  useEffect(() => {
    const raw = value.trim();
    if (raw === lastQueryRef.current && open) return; // avoid re-fetch on highlight nav
    lastQueryRef.current = raw;
    if (!raw) { setMatches([]); setOpen(false); setHi(-1); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const d = await api<{ students: StudentSuggestion[] }>(`/api/lookup?q=${encodeURIComponent(raw)}`, { silent: true });
        setMatches(d.students.slice(0, 12));
        setOpen(true);
        setHi(d.students.length === 1 ? 0 : -1);
      } catch { /* silent — grid below still shows server results */ }
      finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(t); setLoading(false); };
  }, [value]);

  // click outside → close
  useEffect(() => {
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("touchstart", onDoc); };
  }, []);

  function pick(s: StudentSuggestion) {
    setOpen(false);
    setMatches([]);
    setHi(-1);
    inputRef.current?.blur();
    onPick(s);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => (h + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h <= 0 ? matches.length - 1 : h - 1)); }
    else if (e.key === "Enter") {
      if (hi >= 0 && hi < matches.length) { e.preventDefault(); e.stopPropagation(); pick(matches[hi]); }
    }
  }

  const active = focused || (value.trim().length > 0);

  return (
    <div ref={wrapRef} className={cn("relative", className)} data-testid="student-search">
      <div
        className={cn(
          "relative rounded-2xl bg-card transition-all duration-150",
          active
            ? "border-2 shadow-lg"
            : "border-2 border-input shadow-sm"
        )}
        style={active ? { borderColor: "var(--c-primary)" } : undefined}
      >
        <Search
          className={cn(
            "absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none z-10 transition-colors",
            active ? "nk-brand-text" : "text-muted-foreground"
          )}
        />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder ?? "ابحث عن طالب — الاسم أو الكود أو الموبايل"}
          aria-label="البحث عن طالب"
          className={cn(
            "w-full h-13 md:h-14 rounded-2xl bg-transparent ps-12 pe-11 text-base md:text-lg font-extrabold text-start placeholder:font-semibold placeholder:text-muted-foreground/70 focus-visible:outline-none",
            inputClassName
          )}
          style={{ minHeight: "52px" }}
          value={value}
          onChange={(e) => onChange(normalizeDigits(e.target.value))}
          onKeyDown={onKeyDown}
          onFocus={() => { setFocused(true); if (matches.length > 0 && value.trim()) setOpen(true); }}
          onBlur={() => setFocused(false)}
          autoComplete="off"
          dir="auto"
        />
        {/* مسح سريع */}
        {value.trim().length > 0 && !loading && (
          <button
            type="button"
            aria-label="مسح البحث"
            onClick={() => { onChange(""); setMatches([]); setOpen(false); inputRef.current?.focus(); }}
            className="absolute end-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-muted hover:bg-muted/70 text-muted-foreground grid place-items-center transition z-10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {loading && (
          <span className="absolute end-3.5 top-1/2 -translate-y-1/2 z-10">
            <Loader2 className="w-5 h-5 animate-spin nk-brand-text" />
          </span>
        )}
      </div>

      {open && (
        <div className="absolute z-40 top-[calc(100%+6px)] inset-x-0 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden nk-animate-pop">
          {matches.length === 0 && !loading ? (
            <p className="px-4 py-3.5 text-sm font-bold text-muted-foreground">مفيش طالب بالاسم أو الكود ده.</p>
          ) : (
            <div className="max-h-[min(60vh,20rem)] overflow-y-auto nk-scroll">
              {matches.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(m)}
                  className={cn(
                    "w-full px-3.5 py-3 text-start border-b last:border-0 flex items-center gap-3 transition",
                    i === hi ? "bg-[color-mix(in_srgb,var(--c-primary)_8%,white)]" : "bg-card hover:bg-muted/60"
                  )}
                >
                  <span className="w-9 h-9 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center font-extrabold text-sm shrink-0">
                    {m.name.trim()[0]}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-extrabold text-[15px] truncate">{m.name}</span>
                    {m.grade && <span className="block text-xs text-muted-foreground font-semibold">{m.grade}</span>}
                  </span>
                  <span className="nk-num text-sm font-bold nk-brand-text shrink-0" dir="ltr">{m.code}</span>
                </button>
              ))}
              <p className="px-3.5 py-2 text-[11px] font-bold text-muted-foreground bg-muted/40 flex items-center gap-1.5 border-t">
                <UserRound className="w-3.5 h-3.5" /> اختار باللمس أو ↑↓ ثم Enter
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
