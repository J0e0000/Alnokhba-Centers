"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { fmt, formatDateAR, todayStr } from "./lib";
import type { CenterInfo } from "./lib";

/* ============================================================
   طباعة مركزية قوية:
   - المحتوى المطلوب طباعته بيتحط في #nk-print-root (portal على body)
   - في وضع الطباعة كل أبناء body بتتقفل ما عدا الجذر ده
     (display:none مش visibility → مفيش صفحات فاضية ولا قص من الـ dialogs)
   - print-color-adjust:exact → الألوان والخلفيات بتتطبع فعلاً
   - بنستنى الصور (QR) تحمّل قبل ما نفتح حوار الطباعة
============================================================ */

type PrintRequest = { node: ReactNode; title?: string };

const PrintCtx = createContext<(node: ReactNode, title?: string) => void>(() => {});

export function usePrint() {
  return useContext(PrintCtx);
}

export function PrintProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<PrintRequest | null>(null);
  const prevTitle = useRef("");

  const print = useCallback((node: ReactNode, title?: string) => {
    setReq({ node, title });
  }, []);

  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    const prev = document.title;
    if (req.title) document.title = req.title;
    prevTitle.current = prev;

    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      window.removeEventListener("afterprint", cleanup);
      document.title = prevTitle.current;
      setReq(null);
    };
    window.addEventListener("afterprint", cleanup);

    // استنى الرسم + الصور (كروت QR بتكون data-URL فبتحمّل فوراً) قبل فتح الحوار
    const run = async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("#nk-print-root img"));
      if (imgs.length) {
        await Promise.all(
          imgs.map((img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener("load", () => res(), { once: true });
                  img.addEventListener("error", () => res(), { once: true });
                  setTimeout(res, 2500); // سقف أمان
                }),
          ),
        );
      }
      if (cancelled) return;
      window.print();
      // سقف أمان لو afterprint مأجلتش في المتصفح
      setTimeout(cleanup, 1500);
    };
    run();

    return () => {
      window.removeEventListener("afterprint", cleanup);
      document.title = prev;
    };
  }, [req]);

  return (
    <PrintCtx.Provider value={print}>
      {children}
      {req &&
        createPortal(
          <div id="nk-print-root" dir="rtl">
            {req.node}
          </div>,
          document.body,
        )}
    </PrintCtx.Provider>
  );
}

/* ============================================================
   1) كروت الطلاب للطباعة — شبكة بمقاس كارت البنك مع خطوط قص
============================================================ */

type CardData = {
  name: string; code: string; grade: string; group: string; qrDataUrl: string;
};

export function PrintableCards({ cards, center }: { cards: CardData[]; center: CenterInfo | null }) {
  return (
    <div className="nk-print-cards">
      {cards.map((c, i) => (
        <CardForPrint key={c.code} card={c} center={center} index={i} />
      ))}
    </div>
  );
}

/** نسخة الطباعة من الكارت — نفس تصميم الشاشة لكن بدون ظلال وبتدرجات قابلة للطباعة */
function CardForPrint({ card, center, index }: { card: CardData; center: CenterInfo | null; index: number }) {
  const primary = center?.primaryColor ?? "#0E9F6E";
  const secondary = center?.secondaryColor ?? "#0F766E";
  return (
    <div className="nk-print-card" style={{ width: "85.6mm", height: "53.98mm", borderRadius: "3mm", overflow: "hidden", border: "0.4mm dashed #b9c6cc", background: "#fff", position: "relative" }}>
      <div style={{ height: "13mm", background: `linear-gradient(120deg, ${primary}, ${secondary})`, display: "flex", alignItems: "center", gap: "2.5mm", padding: "0 4mm", color: "#fff" }}>
        {center?.logo ? (
          <img src={center.logo} alt="" style={{ height: "8.5mm", width: "8.5mm", borderRadius: "2mm", objectFit: "cover", background: "#fff", border: "0.4mm solid rgba(255,255,255,.7)" }} />
        ) : (
          /* لوجو النظام الأساسي على الكارت المطبوع */
          <img src="/logo.png" alt="" style={{ height: "8.5mm", width: "8.5mm", borderRadius: "2mm", objectFit: "contain", background: "#fff", border: "0.4mm solid rgba(255,255,255,.7)", padding: "0.4mm" }} />
        )}
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: "3.6mm", fontWeight: 800 }}>{center?.name ?? "السنتر"}</div>
          <div style={{ fontSize: "2.2mm", fontWeight: 700, opacity: 0.85 }}>{center?.slogan ?? "Alnokhba Managment"}</div>
        </div>
        <div style={{ marginInlineStart: "auto", fontSize: "2.2mm", fontWeight: 800, letterSpacing: "0.4mm", opacity: 0.85 }}>ALNOKHBA</div>
      </div>

      <div style={{ display: "flex", height: "calc(100% - 13mm - 8mm)", padding: "2.5mm 4mm", gap: "3mm", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0, direction: "rtl" }}>
          <div style={{ fontSize: "4.1mm", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</div>
          <div style={{ fontSize: "2.8mm", color: "#5c6f77", fontWeight: 700, marginTop: "1mm" }}>
            {card.grade}{card.group ? ` · مجموعة ${card.group}` : ""}
          </div>
          <div style={{ marginTop: "2mm", display: "inline-flex", alignItems: "center", gap: "1.5mm", background: `color-mix(in srgb, ${primary} 12%, #fff)`, borderRadius: "2mm", padding: "1mm 2.5mm" }}>
            <span style={{ fontSize: "2.4mm", fontWeight: 800, color: secondary }}>كود الطالب</span>
            <span style={{ fontSize: "4.6mm", fontWeight: 900, letterSpacing: "1.2mm", color: primary, fontVariantNumeric: "tabular-nums" }}>{card.code}</span>
          </div>
        </div>
        <img src={card.qrDataUrl} alt="QR" style={{ width: "26mm", height: "26mm", borderRadius: "2mm", border: "0.3mm solid #e2e8eb", padding: "0.6mm" }} />
      </div>

      <div style={{ position: "absolute", bottom: 0, insetInline: 0, height: "8mm", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4mm", borderTop: "0.3mm solid #eef2f3", background: "#fafcfc" }}>
        <span style={{ fontSize: "2.3mm", fontWeight: 700, color: "#5c6f77", direction: "rtl" }}>
          {center?.phone ? `☎ ${center.phone}` : ""}{center?.address ? ` · ${center.address.slice(0, 42)}` : ""}
        </span>
        <span style={{ fontSize: "2mm", color: "#9aa8ae", fontWeight: 700, letterSpacing: "0.3mm" }}>#{String(index + 1).padStart(3, "0")}</span>
      </div>
    </div>
  );
}

/* ============================================================
   3) إيصال دفع — نسخة A4 + نسخة ثيرمال 80mm
============================================================ */

export type ReceiptData = {
  receipt: {
    type?: "PAYMENT" | "REFUND" | "ADJUSTMENT";
    number: string | null;
    seq?: number | null;
    amount: number;
    method: string | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
    outstanding: number | null;
    credit: number | null;
    note: string | null;
    issuedByName: string;
    date: string;
    createdAt: string;
  };
  student: { name: string; code: string; parentName: string | null; parentPhone: string | null; grade: string | null } | null;
  session: { subject: string; date: string; time: string; room: string | null } | null;
  center: { name: string; logo: string | null; phone: string | null; address: string | null; slogan: string | null };
};

const METHOD_AR: Record<string, string> = { CASH: "كاش", VODAFONE: "محفظة فودافون", INSTAPAY: "انستاباي" };

function methodAr(m: string | null): string {
  return (m && METHOD_AR[m]) || "—";
}

/** عناوين وأنصاف حسب نوع المعاملة (دفع / استرداد / تسوية) */
const RC_TYPE_AR: Record<string, { title: string; amountLabel: string }> = {
  PAYMENT: { title: "إيصال استلام", amountLabel: "المبلغ المستلم" },
  REFUND: { title: "إيصال استرداد", amountLabel: "المبلغ المردود" },
  ADJUSTMENT: { title: "إيصال تسوية", amountLabel: "قيمة التسوية" },
};

function rcType(t?: string | null) {
  return RC_TYPE_AR[t ?? "PAYMENT"] ?? RC_TYPE_AR.PAYMENT;
}

function receiptStamp(data: ReceiptData): string {
  const d = new Date(data.receipt.createdAt);
  const date = d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  return `${date} — ${time}`;
}

/** صف تفصيلة في الإيصال (module-level — مش بيتعمل كل render) */
function RcRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="nk-rc-row" style={strong ? { fontWeight: 900 } : undefined}>
      <span className="nk-rc-label">{label}</span>
      <span className="nk-rc-value nk-num" dir="ltr">{value}</span>
    </div>
  );
}

/** A4 receipt — نصف ورقة، هيدر براند + تفاصيل + توقيع */
export function PrintableReceiptA4({ data, center }: { data: ReceiptData; center: CenterInfo | null }) {
  const primary = center?.primaryColor ?? "#0E9F6E";
  const secondary = center?.secondaryColor ?? "#0F766E";
  const r = data.receipt;
  const s = data.student;
  const t = rcType(r.type);
  const isRefund = r.type === "REFUND";

  return (
    <div className="nk-print-receipt nk-rc-a4">
      {/* header */}
      <div className="nk-rc-header" style={{ background: `linear-gradient(120deg, ${primary}, ${secondary})` }}>
        {data.center.logo ? (
          <img src={data.center.logo} alt="" className="nk-rc-logo" />
        ) : (
          /* لوجو النظام الأساسي على الإيصال */
          <img src="/logo.png" alt="" className="nk-rc-logo" style={{ objectFit: "contain", background: "#fff" }} />
        )}
        <div className="nk-rc-brand">
          <div className="nk-rc-center-name">{data.center.name}</div>
          <div className="nk-rc-center-sub">{data.center.slogan || (data.center.phone ? `☎ ${data.center.phone}` : "إيصال استلام نقدي")}</div>
        </div>
        <div className="nk-rc-titlebox">
          <div className="nk-rc-title">{t.title}</div>
          <div className="nk-rc-number nk-num" dir="ltr">{r.number ?? "—"}</div>
        </div>
      </div>

      {/* meta strip — التاريخ والوقت باينين + الموظف المسؤول عن العملية */}
      <div className="nk-rc-meta">
        <span>التاريخ والوقت: <b className="nk-num" dir="ltr">{receiptStamp(data)}</b></span>
        <span>الموظف المسؤول: <b>{r.issuedByName}</b></span>
      </div>

      {/* student + session */}
      <div className="nk-rc-cols">
        <div className="nk-rc-col">
          <div className="nk-rc-coltitle">بيانات الطالب</div>
          <div className="nk-rc-line"><span>الاسم</span><b>{s?.name ?? "—"}</b></div>
          <div className="nk-rc-line"><span>الكود</span><b className="nk-num" dir="ltr">{s?.code ?? "—"}</b></div>
          <div className="nk-rc-line"><span>المرحلة</span><b>{s?.grade ?? "—"}</b></div>
          <div className="nk-rc-line"><span>ولي الأمر</span><b>{s?.parentName ?? "—"}</b></div>
        </div>
        <div className="nk-rc-col">
          <div className="nk-rc-coltitle">{data.session ? "الحصة المسجلة عليها المعاملة" : (isRefund ? "استرداد نقدي" : "معاملة على الحساب")}</div>
          {data.session ? (
            <>
              <div className="nk-rc-line"><span>المادة</span><b>{data.session.subject}</b></div>
              <div className="nk-rc-line"><span>التاريخ</span><b className="nk-num" dir="ltr">{formatDateAR(data.session.date)}</b></div>
              <div className="nk-rc-line"><span>الوقت</span><b className="nk-num" dir="ltr">{data.session.time}</b></div>
              <div className="nk-rc-line"><span>القاعة</span><b>{data.session.room ?? "—"}</b></div>
            </>
          ) : (
            <div className="nk-rc-line"><span>النوع</span><b>{isRefund ? "استرداد مبلغ للطالب" : (r.type === "ADJUSTMENT" ? "تسوية رصيد" : "تسديد رصيد / شحن حساب")}</b></div>
          )}
        </div>
      </div>

      {/* money box */}
      <div className="nk-rc-money">
        <div className="nk-rc-amount">
          <span className="nk-rc-amount-label">{t.amountLabel}</span>
          <span className="nk-rc-amount-value nk-num" dir="ltr">{fmt(Math.abs(r.amount))} جنيه</span>
          <span className="nk-rc-amount-method">طريقة الدفع: {methodAr(r.method)}</span>
        </div>
        {r.balanceBefore !== null && r.balanceAfter !== null && (
          <div className="nk-rc-balances">
            <RcRow label="الرصيد قبل المعاملة" value={`${fmt(r.balanceBefore)} ج`} />
            <RcRow label="الرصيد بعد المعاملة" value={`${fmt(r.balanceAfter)} ج`} strong />
            {r.outstanding !== null && r.credit !== null && (
              <RcRow label={r.outstanding > 0 ? "المتبقي على الطالب" : "رصيد الطالب الحالي"} value={r.outstanding > 0 ? `${fmt(r.outstanding)} ج` : `${fmt(r.credit)} ج`} />
            )}
          </div>
        )}
      </div>

      {r.note ? <div className="nk-rc-note">ملاحظة: {r.note}</div> : null}

      {/* signature */}
      <div className="nk-rc-sign">
        <div className="nk-rc-signbox">
          <span>{isRefund ? "توقيع المستلِم" : "توقيع المستلم"}</span>
        </div>
        <div className="nk-rc-signbox">
          <span>ختم السنتر</span>
        </div>
      </div>

      <div className="nk-rc-footer">
        <span>{data.center.address ? `${data.center.address} · ` : ""}{data.center.phone ? `☎ ${data.center.phone}` : ""}</span>
        <span>هذا الإيصال دليل معاملة — يُرجى الاحتفاظ به</span>
      </div>
    </div>
  );
}

/** Thermal 80mm receipt — طباعة كاشير مضغوطة */
export function PrintableReceiptThermal({ data, center }: { data: ReceiptData; center: CenterInfo | null }) {
  const r = data.receipt;
  const s = data.student;
  const t = rcType(r.type);
  return (
    <div className="nk-print-receipt nk-rc-thermal">
      <div className="nkt-center">
        <div className="nkt-name">{data.center.name}</div>
        {data.center.slogan ? <div className="nkt-sub">{data.center.slogan}</div> : null}
        {data.center.phone ? <div className="nkt-sub nk-num" dir="ltr">☎ {data.center.phone}</div> : null}
        <div className="nkt-sep">──────────────────────</div>
        <div className="nkt-title">{t.title}</div>
        {r.number ? <div className="nkt-rcode nk-num" dir="ltr">{r.number}</div> : null}
      </div>
      <div className="nkt-sep">──────────────────────</div>
      <div className="nkt-line"><span>التاريخ والوقت</span><b className="nk-num" dir="ltr">{receiptStamp(data)}</b></div>
      <div className="nkt-line"><span>الموظف</span><b>{r.issuedByName}</b></div>
      <div className="nkt-line"><span>الطالب</span><b>{s?.name ?? "—"}</b></div>
      <div className="nkt-line"><span>الكود</span><b className="nk-num" dir="ltr">{s?.code ?? "—"}</b></div>
      {data.session ? <div className="nkt-line"><span>الحصة</span><b>{data.session.subject} · {data.session.date}</b></div> : null}
      <div className="nkt-sep">──────────────────────</div>
      <div className="nkt-amount-row">
        <span>{r.type === "REFUND" ? "المردود" : "المستلم"}</span>
        <b className="nk-num" dir="ltr">{fmt(Math.abs(r.amount))} ج</b>
      </div>
      <div className="nkt-line"><span>طريقة الدفع</span><b>{methodAr(r.method)}</b></div>
      {r.balanceAfter !== null ? <div className="nkt-line"><span>الرصيد بعد المعاملة</span><b className="nk-num" dir="ltr">{fmt(r.balanceAfter)} ج</b></div> : null}
      {r.outstanding !== null && r.outstanding > 0 ? <div className="nkt-line"><span>المتبقي عليه</span><b className="nk-num" dir="ltr">{fmt(r.outstanding)} ج</b></div> : null}
      {r.note ? <div className="nkt-note">ملاحظة: {r.note}</div> : null}
      <div className="nkt-sep">──────────────────────</div>
      <div className="nkt-center">
        <div className="nkt-sign-line">توقيع المستلم: ....................</div>
        <div className="nkt-sub" style={{ marginTop: "2mm" }}>الإيصال دليل معاملة — يُرجى الاحتفاظ به</div>
      </div>
      <div className="nkt-cut">✂ ──────────────────</div>
    </div>
  );
}

type ReportCol = { key: string; label: string; type?: "text" | "money" | "number" | "date" };
export type PrintableReportData = {
  type: string; title: string; from: string; to: string;
  columns: ReportCol[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
  statCards: { label: string; value: number; kind: "money" | "number" }[];
  centerName: string;
};

export function PrintableReport({ data, center }: { data: PrintableReportData; center: CenterInfo | null }) {
  const primary = center?.primaryColor ?? "#0E9F6E";
  const secondary = center?.secondaryColor ?? "#0F766E";
  const now = new Date();
  const stamp = `${formatDateAR(todayStr(now))} · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="nk-print-report">
      {/* هيدر رسمي */}
      <div className="nk-pr-header">
        <div className="nk-pr-brand">
          {center?.logo ? (
            <img src={center.logo} alt="" className="nk-pr-logo" />
          ) : (
            /* لوجو النظام الأساسي على التقارير المطبوعة */
            <img src="/logo.png" alt="" className="nk-pr-logo" style={{ objectFit: "contain", background: "#fff" }} />
          )}
          <div>
            <div className="nk-pr-center">{center?.name ?? data.centerName}</div>
            <div className="nk-pr-sub">{center?.slogan ?? "Alnokhba Managment"}</div>
          </div>
        </div>
        <div className="nk-pr-meta">
          <div className="nk-pr-title">{data.title}</div>
          <div className="nk-pr-range">من {formatDateAR(data.from)} لـ {formatDateAR(data.to)}</div>
        </div>
      </div>

      {/* بطاقات الإحصائيات */}
      {data.statCards.length > 0 && (
        <div className="nk-pr-stats">
          {data.statCards.map((c, i) => (
            <div key={i} className="nk-pr-stat">
              <div className="nk-pr-stat-label">{c.label}</div>
              <div className="nk-pr-stat-value" style={i === 0 ? { color: primary } : undefined}>
                {c.kind === "money" ? fmt(c.value) : String(c.value)}
                {c.kind === "money" ? " ج" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* الجدول */}
      <table className="nk-pr-table">
        <thead>
          <tr>
            {data.columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              {data.columns.map((c) => {
                const v = r[c.key];
                const numeric = c.type === "money" || c.type === "number";
                return (
                  <td key={c.key}
                    className={c.type === "money" ? "nk-num" : undefined}
                    dir={numeric ? "ltr" : undefined}
                    style={{
                      ...(numeric ? { textAlign: "start" } : {}),
                      ...(c.type === "money" && Number(v) < 0 ? { color: "#dc2626", fontWeight: 800 } : {}),
                    }}>
                    {c.type === "money" ? fmt(Number(v)) :
                     c.type === "date" ? formatDateAR(String(v)) :
                     String(v ?? "—")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {Object.keys(data.totals).length > 0 && (
          <tfoot>
            <tr>
              {data.columns.map((c, i) => (
                <td key={c.key} className="nk-num"
                  dir={c.type === "money" || c.type === "number" ? "ltr" : undefined}
                  style={c.type === "money" || c.type === "number" ? { textAlign: "start" } : undefined}>
                  {i === 0 ? "الإجمالي" : data.totals[c.key] !== undefined ? (c.type === "money" ? fmt(data.totals[c.key]) : data.totals[c.key]) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>

      {/* تذييل */}
      <div className="nk-pr-footer">
        <span>اتولد بواسطة Alnokhba Managment</span>
        <span className="nk-num" dir="ltr">{stamp}</span>
      </div>
    </div>
  );
}

export type DayScheduleHall = {
  name: string;
  capacity: number | null;
  slots: { startTime: string; endTime: string; subject: string; grade: string; groupName: string; teacher: string; students: number }[];
};

export function PrintableDaySchedule({ dayLabel, dateStr, halls, center }: {
  dayLabel: string;
  dateStr: string;
  halls: DayScheduleHall[];
  center: CenterInfo | null;
}) {
  const primary = center?.primaryColor ?? "#0E9F6E";
  const secondary = center?.secondaryColor ?? "#0F766E";
  const totalSlots = halls.reduce((n, h) => n + h.slots.length, 0);
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="nk-print-report nk-day-schedule">
      {/* هيدر */}
      <div className="nk-pr-header">
        <div className="nk-pr-brand">
          {center?.logo ? (
            <img src={center.logo} alt="" className="nk-pr-logo" />
          ) : (
            /* لوجو النظام الأساسي على التقارير المطبوعة */
            <img src="/logo.png" alt="" className="nk-pr-logo" style={{ objectFit: "contain", background: "#fff" }} />
          )}
          <div>
            <div className="nk-pr-center">{center?.name ?? "السنتر"}</div>
            <div className="nk-pr-sub">{center?.slogan ?? "Alnokhba Managment"}</div>
          </div>
        </div>
        <div className="nk-pr-meta">
          <div className="nk-pr-title">جدول {dayLabel}</div>
          <div className="nk-pr-range">{formatDateAR(dateStr)}</div>
        </div>
      </div>

      {totalSlots === 0 ? (
        <div style={{ textAlign: "center", padding: "18mm 0", fontWeight: 800, color: "#71828a" }}>
          مفيش حصص مجدولة يوم {dayLabel}
        </div>
      ) : (
        halls.map((hall) => (
          <div key={hall.name} className="nk-day-hall" style={{ breakInside: "avoid" }}>
            <div className="nk-day-hall-title" style={{ background: `color-mix(in srgb, ${primary} 10%, #fff)`, borderInlineStart: `1.2mm solid ${primary}` }}>
              <span style={{ fontWeight: 900, fontSize: "4.2mm", color: secondary }}>{hall.name || "بدون قاعة"}</span>
              <span className="nk-num" style={{ fontSize: "3mm", fontWeight: 800, color: "#71828a" }}>
                {hall.slots.length} حصة{hall.capacity ? ` · سعة ${hall.capacity} طالب` : ""}
              </span>
            </div>
            <table className="nk-pr-table">
              <thead>
                <tr>
                  <th style={{ width: "24mm" }}>الوقت</th>
                  <th>الحصة</th>
                  <th style={{ width: "34mm" }}>المدرس</th>
                  <th style={{ width: "18mm", textAlign: "center" }}>الطلاب</th>
                </tr>
              </thead>
              <tbody>
                {hall.slots.map((s, i) => (
                  <tr key={i}>
                    <td className="nk-num" dir="ltr" style={{ fontWeight: 800, textAlign: "start" }}>
                      {formatTime12Safe(s.startTime)} – {formatTime12Safe(s.endTime)}
                    </td>
                    <td style={{ fontWeight: 800 }}>{s.subject} — {s.grade} {s.groupName}</td>
                    <td>{s.teacher}</td>
                    <td className="nk-num" dir="ltr" style={{ textAlign: "center" }}>{s.students}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <div className="nk-pr-footer">
        <span>{center?.phone ? `☎ ${center.phone}` : ""}{center?.address ? ` · ${center.address}` : ""}</span>
        <span className="nk-num" dir="ltr">{stamp}</span>
      </div>
    </div>
  );
}

function formatTime12Safe(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  if (!isFinite(h)) return hm;
  const period = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

/* ============================================================
   5) كشف حضور حصة — ورقة توقيع للمدرس
============================================================ */

export type AttendanceSheetData = {
  session: {
    subject: string; grade: string; groupName: string; teacher: string;
    date: string; startTime: string; endTime: string; room: string | null; price: number;
  };
  attendance: { name: string; code: string; status: string; charged: number | null; at: string | null }[];
  absent: { name: string; code: string }[];
};

export function PrintableAttendanceSheet({ data, center }: { data: AttendanceSheetData; center: CenterInfo | null }) {
  const primary = center?.primaryColor ?? "#0E9F6E";
  const secondary = center?.secondaryColor ?? "#0F766E";
  const s = data.session;
  const now = new Date();
  const stamp = `${formatDateAR(todayStr(now))} · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const present = data.attendance;

  return (
    <div className="nk-print-report nk-att-sheet">
      {/* هيدر */}
      <div className="nk-pr-header">
        <div className="nk-pr-brand">
          {center?.logo ? (
            <img src={center.logo} alt="" className="nk-pr-logo" />
          ) : (
            <div className="nk-pr-logo nk-pr-logo-ph" style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}>
              {(center?.name ?? "ن").trim()[0]}
            </div>
          )}
          <div>
            <div className="nk-pr-center">{center?.name ?? "السنتر"}</div>
            <div className="nk-pr-sub">كشف حضور</div>
          </div>
        </div>
        <div className="nk-pr-meta">
          <div className="nk-pr-title">{s.subject} — {s.grade} {s.groupName}</div>
          <div className="nk-pr-range">
            {formatDateAR(s.date)} · {formatTime12Safe(s.startTime)} – {formatTime12Safe(s.endTime)}{s.room ? ` · ${s.room}` : ""}
          </div>
        </div>
      </div>

      {/* ملخص */}
      <div className="nk-pr-stats">
        <div className="nk-pr-stat">
          <div className="nk-pr-stat-label">حضر</div>
          <div className="nk-pr-stat-value nk-num" style={{ color: primary }}>{present.length}</div>
        </div>
        <div className="nk-pr-stat">
          <div className="nk-pr-stat-label">محضروش</div>
          <div className="nk-pr-stat-value nk-num">{data.absent.length}</div>
        </div>
        <div className="nk-pr-stat">
          <div className="nk-pr-stat-label">سعر الحصة</div>
          <div className="nk-pr-stat-value nk-num">{fmt(s.price)} ج</div>
        </div>
        <div className="nk-pr-stat">
          <div className="nk-pr-stat-label">المدرس</div>
          <div className="nk-pr-stat-value" style={{ fontSize: "4mm" }}>{s.teacher}</div>
        </div>
      </div>

      {/* الحضور */}
      <table className="nk-pr-table">
        <thead>
          <tr>
            <th style={{ width: "10mm", textAlign: "center" }}>#</th>
            <th>الطالب</th>
            <th style={{ width: "22mm" }}>الكود</th>
            <th style={{ width: "24mm", textAlign: "center" }}>الحالة</th>
            <th style={{ width: "30mm" }}>توقيع الطالب</th>
          </tr>
        </thead>
        <tbody>
          {present.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: "center", fontWeight: 800, padding: "10mm 0" }}>لسه محدش حضر</td></tr>
          ) : (
            present.map((a, i) => (
              <tr key={a.code + i}>
                <td className="nk-num" dir="ltr" style={{ textAlign: "center", fontWeight: 800 }}>{i + 1}</td>
                <td style={{ fontWeight: 800 }}>{a.name}</td>
                <td className="nk-num" dir="ltr">{a.code}</td>
                <td style={{ textAlign: "center", fontWeight: a.status === "PRESENT" ? 700 : 900, color: a.status === "PRESENT" ? undefined : "#b45309" }}>
                  {a.status === "PRESENT" ? "حاضر" : a.status === "LATE" ? "متأخر" : "بعذر"}
                </td>
                <td></td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* المحضروش */}
      {data.absent.length > 0 && (
        <>
          <div className="nk-day-hall-title" style={{ background: "#fdf2f2", borderInlineStart: "1.2mm solid #dc2626", marginTop: "5mm" }}>
            <span style={{ fontWeight: 900, fontSize: "3.8mm", color: "#b91c1c" }}>مسجلين ومحضروش ({data.absent.length})</span>
          </div>
          <div style={{ fontSize: "3.2mm", fontWeight: 700, lineHeight: 2, color: "#374151" }}>
            {data.absent.map((a) => `${a.name} (${a.code})`).join(" · ")}
          </div>
        </>
      )}

      {/* توقيع المدرس */}
      <div className="nk-rc-sign" style={{ marginTop: "8mm" }}>
        <div className="nk-rc-signbox"><span>توقيع المدرس</span></div>
        <div className="nk-rc-signbox"><span>ختم السنتر</span></div>
      </div>

      <div className="nk-pr-footer">
        <span>اتولد بواسطة Alnokhba Managment</span>
        <span className="nk-num" dir="ltr">{stamp}</span>
      </div>
    </div>
  );
}
