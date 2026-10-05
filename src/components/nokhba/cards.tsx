"use client";

import { useEffect, useState } from "react";
import { Printer, Loader2 } from "lucide-react";
import { api, type CenterInfo } from "./lib";
import { usePrint, PrintableCards, brandInk, brandOnLight } from "./print";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type CardData = {
  name: string; code: string; grade: string; group: string; qrDataUrl: string;
};

/** Printable bank-card-sized student card with center branding (85.6 × 53.98 mm) */
export function StudentCard({ card, center, index }: { card: CardData; center: CenterInfo | null; index: number }) {
  const primary = center?.primaryColor ?? "#0E9F6E";
  const secondary = center?.secondaryColor ?? "#0F766E";
  const headerInk = brandInk(primary, secondary);
  return (
    <div className="nk-print-card relative shrink-0" style={{ width: "85.6mm", height: "53.98mm", borderRadius: "4.5mm", overflow: "hidden", border: "1px solid #e2e8eb", background: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,.08)", color: "#1b2635" }}>
      {/* brand header */}
      <div style={{ height: "13mm", background: `linear-gradient(120deg, ${primary}, ${secondary})`, display: "flex", alignItems: "center", gap: "2.5mm", padding: "0 4mm", color: headerInk }}>
        {center?.logo ? (
          <img src={center.logo} alt="" style={{ height: "8.5mm", width: "8.5mm", borderRadius: "2mm", objectFit: "cover", background: "#fff", border: "0.4mm solid rgba(255,255,255,.7)" }} />
        ) : (
          /* لوجو النظام الأساسي على كارت الطالب */
          <img src="/logo.png" alt="" style={{ height: "8.5mm", width: "8.5mm", borderRadius: "2mm", objectFit: "contain", background: "#fff", border: "0.4mm solid rgba(255,255,255,.7)", padding: "0.4mm" }} />
        )}
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: "3.6mm", fontWeight: 800 }}>{center?.name ?? "السنتر"}</div>
          <div style={{ fontSize: "2.2mm", fontWeight: 700, opacity: 0.85 }}>{center?.slogan ?? "AlNokhba Management"}</div>
        </div>
        <div style={{ marginInlineStart: "auto", fontSize: "2.2mm", fontWeight: 800, letterSpacing: "0.4mm", opacity: 0.85 }}>ALNOKHBA</div>
      </div>

      {/* body */}
      <div style={{ display: "flex", height: "calc(100% - 13mm - 8mm)", padding: "2.5mm 4mm", gap: "3mm", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0, direction: "rtl" }}>
          <div style={{ fontSize: "4.1mm", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</div>
          <div style={{ fontSize: "2.8mm", color: "#5c6f77", fontWeight: 700, marginTop: "1mm" }}>
            {card.grade}{card.group ? ` · مجموعة ${card.group}` : ""}
          </div>
          <div style={{ marginTop: "2mm", display: "inline-flex", alignItems: "center", gap: "1.5mm", background: `color-mix(in srgb, ${primary} 12%, #fff)`, borderRadius: "2mm", padding: "1mm 2.5mm" }}>
            <span style={{ fontSize: "2.4mm", fontWeight: 800, color: brandOnLight(secondary) }}>كود الطالب</span>
            <span style={{ fontSize: "4.6mm", fontWeight: 900, letterSpacing: "1.2mm", color: brandOnLight(primary), fontVariantNumeric: "tabular-nums" }}>{card.code}</span>
          </div>
        </div>
        <img src={card.qrDataUrl} alt="QR" style={{ width: "26mm", height: "26mm", borderRadius: "2mm", border: "0.3mm solid #e2e8eb", padding: "0.6mm" }} />
      </div>

      {/* footer */}
      <div style={{ position: "absolute", bottom: 0, insetInline: 0, height: "8mm", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4mm", borderTop: "0.3mm solid #eef2f3", background: "#fafcfc" }}>
        <span style={{ fontSize: "2.3mm", fontWeight: 700, color: "#5c6f77", direction: "rtl" }}>
          {center?.phone ? `☎ ${center.phone}` : ""}{center?.address ? ` · ${center.address.slice(0, 42)}` : ""}
        </span>
        <span style={{ fontSize: "2mm", color: "#9aa8ae", fontWeight: 700, letterSpacing: "0.3mm" }}>#{String(index + 1).padStart(3, "0")}</span>
      </div>
    </div>
  );
}

export function StudentCardPrint({ open, onClose, studentIds, center }: {
  open: boolean; onClose: () => void; studentIds: string[]; center: CenterInfo | null;
}) {
  const [cards, setCards] = useState<CardData[] | null>(null);
  const print = usePrint();
  // reset stale cards when the dialog re-opens (render-time adjustment)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setCards(null);
  }

  useEffect(() => {
    if (open && studentIds.length) {
      api<{ cards: CardData[] }>(`/api/students/${studentIds[0]}/card`, { method: "POST", body: { ids: studentIds }, silent: true })
        .then((d) => setCards(d.cards))
        .catch(() => {
          // fallback: single GET
          api<{ cards: CardData[] }>(`/api/students/${studentIds[0]}/card`)
            .then((d) => setCards(d.cards))
            .catch(() => setCards([]));
        });
    }
  }, [open, studentIds]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle>
            كروت الطلاب
            {!!cards && cards.length > 1 && (
              <span className="ms-2 text-sm font-bold text-muted-foreground nk-num">({cards.length} كارت)</span>
            )}
          </DialogTitle>
        </DialogHeader>
        {!cards ? (
          <div className="py-16 flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
        ) : cards.length === 0 ? (
          <p className="text-sm font-bold text-muted-foreground text-center py-8">مفيش كروت — راجع بيانات الطالب.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 justify-center">
              {cards.map((c, i) => <StudentCard key={c.code} card={c} center={center} index={i} />)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => print(
                  <PrintableCards cards={cards} center={center} />,
                  `كروت الطلاب — ${center?.name ?? "AlNokhba Management"}`,
                )}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                <Printer className="w-5 h-5" /> طباعة {cards.length > 1 ? `(${cards.length} كارت)` : "الكارت"}
              </button>
              <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إغلاق</button>
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold text-center">
              مقاس الكارت زي كارت البنك (85.6×54 مم) — اطبع على كارت PVC أو ورق مقوى.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
