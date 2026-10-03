"use client";

import { useMemo, useState } from "react";
import { CircleHelp, Search, Compass, ChevronDown, MessageCircleQuestion, BookOpenCheck, Image as ImageIcon } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { FAQ_ITEMS, type FaqItem } from "./help-content";
import { defaultCapabilityMap, type CapabilityKey, type CapabilityMap } from "@/lib/capabilities";

/** لقطات شاشة إرشادية للأسئلة الشائعة — المفاتيح المرتبطة بعناصر الـ FAQ.
 *  الصور نفسها اختيارية: لو مش موجودة، البطاقة بتتعرض نصيّ بس. */
const FAQ_IMAGES: Record<string, { src: string; alt: string; caption?: string } | undefined> = {};

/* ============================================================
   نظام المساعدة المدرك للدور والسياق (Role-aware + Context-aware Q&A)
   ------------------------------------------------------------
   - كل سؤال له أدوار (roles) وقدرات مطلوبة (requiresCaps).
   - شاشات المدير بس: أسئلتها مش بتظهر للاستقبال/المعلم.
   - أسئلة ميزة مقفولة في المركز بتختفي تلقائيًا.
   - السياق: أسئلة الشاشة الحالية بتتصدر القايمة دايمًا.
============================================================ */

/** شاشات المدير حصرًا — أسئلتها متتعرضش لباقي الأدوار */
const MANAGER_ONLY_VIEWS = new Set([
  "settings", "accounting", "emergency", "approvals", "monitor", "billing", "centers", "subscriptions", "backups",
]);

/** فلترة الأسئلة: دور المستخدم + قدرات مركزه */
export function filterQa(
  items: FaqItem[],
  ctx: { role?: string | null; caps?: CapabilityMap | null },
): FaqItem[] {
  const caps = ctx.caps ?? defaultCapabilityMap();
  return items.filter((f) => {
    if (f.roles && ctx.role && !f.roles.includes(ctx.role)) return false;
    if (!f.roles && ctx.role && MANAGER_ONLY_VIEWS.has(f.view) && ctx.role !== "MANAGER" && ctx.role !== "ADMIN") return false;
    if (f.requiresCaps?.length && !f.requiresCaps.every((k) => caps[k as CapabilityKey]?.enabled)) return false;
    if (f.anyCaps?.length && !f.anyCaps.some((k) => caps[k as CapabilityKey]?.enabled)) return false;
    return true;
  });
}

export function HelpButton({
  view,
  viewLabel,
  role,
  caps,
}: {
  view: string;
  viewLabel: string;
  role?: string | null;
  caps?: CapabilityMap | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  function toggleGroup(label: string) {
    setOpenGroups((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  }

  const ctx = useMemo(() => ({ role, caps }), [role, caps]);
  const visibleAll = useMemo(() => filterQa(FAQ_ITEMS, ctx), [ctx]);
  const contextual = useMemo(() => visibleAll.filter((f) => f.view === view), [visibleAll, view]);
  const general = useMemo(() => visibleAll.filter((f) => f.view === "general"), [visibleAll]);

  const results = useMemo(() => {
    const needle = q.trim();
    if (!needle) return null;
    return visibleAll.filter((f) => f.q.includes(needle) || f.a.includes(needle) || f.viewLabel.includes(needle));
  }, [q, visibleAll]);

  const groups = useMemo(() => {
    const byLabel = new Map<string, FaqItem[]>();
    for (const f of visibleAll) {
      if (f.view === "general") continue;
      const arr = byLabel.get(f.viewLabel) ?? [];
      arr.push(f);
      byLabel.set(f.viewLabel, arr);
    }
    return [...byLabel.entries()];
  }, [visibleAll]);

  return (
    <>
      {/* الزرار العائم — تحت عالشمال، فوق الناف السفلي في الموبايل */}
      <button
        data-tour="help-btn"
        onClick={() => setOpen(true)}
        aria-label="مساعدة — أسئلة وإجابات عن الشاشة دي"
        className="fixed z-40 bottom-24 lg:bottom-6 start-4 w-12 h-12 rounded-full nk-brand-grad text-white grid place-items-center shadow-lg border-2 border-white/60 active:scale-95 transition hover:brightness-110 print:hidden"
      >
        <CircleHelp className="w-6 h-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 rounded-2xl overflow-hidden">
          <DialogHeader className="p-4 pb-3 border-b nk-brand-bg-soft shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base nk-brand-text">
              <CircleHelp className="w-5 h-5" />
              مساعدة — {viewLabel}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground font-bold mt-1">
              أسئلة وإجابات عن الشاشة اللي انت فيها، وتحتها كل أسئلة النظام
            </DialogDescription>
            <div className="relative mt-3">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث في كل الأسئلة… (مثال: الإيصال)"
                className="w-full h-11 rounded-xl border border-input bg-card ps-9 pe-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto nk-scroll p-4 space-y-5">
            {/* زرار الجولة */}
            <button
              onClick={() => { setOpen(false); window.dispatchEvent(new Event("nk-start-tour")); }}
              className="w-full rounded-2xl nk-brand-grad nk-portal-card p-4 flex items-center gap-3 text-start active:scale-[0.99] transition"
            >
              <span className="w-11 h-11 rounded-xl bg-white/15 grid place-items-center shrink-0">
                <Compass className="w-5.5 h-5.5 text-white" />
              </span>
              <span className="flex-1">
                <span className="block font-extrabold text-sm text-white">شغّل الجولة التعليمية</span>
                <span className="block text-[11px] text-white/80 mt-0.5">لفة سريعة على النظام كله خطوة بخطوة</span>
              </span>
              <ChevronDown className="w-4 h-4 text-white/70 -rotate-90" />
            </button>

            {results ? (
              <section>
                <h3 className="font-extrabold text-sm mb-2 flex items-center gap-1.5">
                  <MessageCircleQuestion className="w-4 h-4 text-muted-foreground" />
                  نتايج البحث ({results.length})
                </h3>
                {results.length === 0 ? (
                  <p className="text-sm text-muted-foreground font-semibold py-3 text-center">
                    مفيش سؤال بالكلمات دي — جرب كلمة تانية (زي: رصيد، إيصال، حضور)
                  </p>
                ) : (
                  <div className="space-y-2">
                    {results.map((f) => <FaqCard key={f.q} f={f} open={expanded === f.q} onToggle={() => setExpanded(expanded === f.q ? null : f.q)} />)}
                  </div>
                )}
              </section>
            ) : (
              <>
                {/* أسئلة الشاشة الحالية */}
                {contextual.length > 0 && (
                  <section>
                    <h3 className="font-extrabold text-sm mb-2 flex items-center gap-1.5">
                      <BookOpenCheck className="w-4 h-4 nk-brand-text" />
                      أسئلة {viewLabel} — الشاشة اللي انت فيها
                    </h3>
                    <div className="space-y-2">
                      {contextual.map((f) => <FaqCard key={f.q} f={f} open={expanded === f.q} onToggle={() => setExpanded(expanded === f.q ? null : f.q)} />)}
                    </div>
                  </section>
                )}

                {/* أسئلة عامة */}
                {general.length > 0 && (
                  <section>
                    <h3 className="font-extrabold text-sm mb-2">أسئلة عامة</h3>
                    <div className="space-y-2">
                      {general.map((f) => <FaqCard key={f.q} f={f} open={expanded === f.q} onToggle={() => setExpanded(expanded === f.q ? null : f.q)} />)}
                    </div>
                  </section>
                )}

                {/* كل الأسئلة بالشاشات */}
                <section>
                  <h3 className="font-extrabold text-sm mb-2 text-muted-foreground">كل أسئلة النظام ({groups.reduce((a, [, items]) => a + items.length, 0)})</h3>
                  <div className="space-y-3">
                    {groups.map(([label, items]) => (
                      <div key={label}>
                        <button
                          onClick={() => toggleGroup(label)}
                          aria-expanded={openGroups.includes(label)}
                          className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 font-bold text-[13px] hover:bg-muted/60 transition"
                        >
                          {label}
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="text-[10px] font-extrabold nk-num">{items.length}</span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${openGroups.includes(label) ? "rotate-180" : ""}`} />
                          </span>
                        </button>
                        {openGroups.includes(label) && (
                          <div className="space-y-2 mt-2 ps-2 border-s-2 nk-brand-border">
                            {items.map((f) => <FaqCard key={f.q} f={f} open={expanded === f.q} onToggle={() => setExpanded(expanded === f.q ? null : f.q)} />)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FaqCard({ f, open, onToggle }: { f: FaqItem; open: boolean; onToggle: () => void }) {
  const img = f.img ? FAQ_IMAGES[f.img] : null;
  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-colors ${open ? "nk-brand-border" : "border-border"}`}>
      <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center justify-between gap-2 px-3.5 py-3 text-start hover:bg-muted/50 transition">
        <span className="font-extrabold text-[13px] leading-snug">{f.q}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {img && <ImageIcon className={`w-3.5 h-3.5 transition-colors ${open ? "nk-brand-text" : "text-muted-foreground/70"}`} aria-hidden />}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-2.5 border-t bg-muted/20">
          <p className="text-[12.5px] leading-relaxed text-foreground/85">{f.a}</p>
          {img && (
            <figure className="mt-2.5">
              <img
                src={img.src}
                alt={img.alt}
                loading="lazy"
                className="w-full rounded-lg border border-border/70 bg-card shadow-sm"
              />
              {img.caption && (
                <figcaption className="text-[10.5px] font-bold text-muted-foreground text-center mt-1">{img.caption}</figcaption>
              )}
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
