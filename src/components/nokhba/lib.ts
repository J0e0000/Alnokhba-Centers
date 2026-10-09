"use client";

import { toast } from "sonner";
import { normalizeDigits, formatEGP, formatTime12, formatDateAR, dayNameAR, todayStr } from "@/lib/normalize";
import { BRAND_DEFAULTS, normalizeCenterBranding, type BrandableCenter } from "@/lib/branding";

export { normalizeDigits, formatEGP, formatTime12, formatDateAR, dayNameAR, todayStr };

// ============================= API =============================

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; silent?: boolean } = {}
): Promise<T> {
  try {
    const res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    // 401 = الجلسة انتهت → ريفرش لشاشة الدخول.
    // لكن محاولة تسجيل الدخول نفسها (username+password من غير action) لو رجعت 401
    // دي «بيانات غلط» مش «جلسة انتهت» — لازم رسالة السيرفر توصل للمستخدم
    // من غير ريفرش يفضّي الفورم ويخليه يفتكر إن النظام مش شغال.
    const b = (opts.body ?? null) as Record<string, unknown> | null;
    const isLoginAttempt =
      path === "/api/auth" && opts.method === "POST" &&
      !!b && !b.action && "username" in b && "password" in b;
    if (res.status === 401 && typeof window !== "undefined" && !isLoginAttempt) {
      window.location.reload();
      throw new Error("انتهت الجلسة — جاري تحميل الصفحة.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: string }).error ?? "حصل خطأ غير متوقع — جرب تاني.";
      if (!opts.silent) toast.error(msg);
      throw new Error(msg);
    }
    return data as T;
  } catch (e) {
    if (e instanceof TypeError) {
      const msg = "مفيش اتصال بالسيرفر — بص على النت وجرب تاني.";
      if (!opts.silent) toast.error(msg);
      throw new Error(msg);
    }
    throw e;
  }
}

// ============================= Types =============================

export type CenterInfo = {
  id: string; name: string; slug: string; logo: string | null;
  primaryColor: string; secondaryColor: string; accentColor: string | null;
  phone: string | null; whatsapp: string | null; address: string | null;
  slogan: string | null; signature: string | null; status: string;
};

export type SessionUser = {
  id: string; name: string; username: string;
  role: "ADMIN" | "MANAGER" | "RECEPTIONIST" | "TEACHER" | "STUDENT";
  /** product scope: "centers" (legacy) | "academia" (AlNokhba Academia) */
  scope?: "centers" | "academia";
  centerId: string | null; canAddStudents: boolean;
  // الصلاحيات الدقيقة المحسومة من السيرفر (الواجهة بتتكيف بيها — الفحص الحقيقي سيرفر-سايد)
  permissions?: string[];
  // إعدادات الطباعة الشخصية (طباعة تلقائية بعد الدفع)
  autoPrintReceipt?: boolean;
  receiptFormat?: "THERMAL" | "A4";
  center: CenterInfo | null;
  /** موجود بس وقت جلسة الدعم الفني (الأدمن متصرف باسم المستخدم) */
  support?: {
    supportId: string;
    byAdminId: string;
    byAdminName: string;
    targetName: string;
    reason: string;
    expiresAt: string;
  } | null;
};

// ============================= صلاحيات (نسخة العميل — للتكييف البصري بس) =============================

/** المستخدم عنده صلاحية مباشرة؟ (المدير دايمًا معاه كل حاجة) */
export function userCan(user: SessionUser | null | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.role === "MANAGER") return true;
  return (user.permissions ?? []).includes(perm);
}

/** صلاحيات الطلب (موظف استقبال بس) */
export function userCanRequest(user: SessionUser | null | undefined, perm: string): boolean {
  if (!user || user.role === "MANAGER") return false;
  return (user.permissions ?? []).includes(perm);
}

// ============================= Money =============================

/** compact piastres → "1,234" or "1,234.50" (no currency word) */
export function fmt(p: number | null | undefined): string {
  const egp = Math.round(p ?? 0) / 100;
  return egp % 1 === 0
    ? egp.toLocaleString("en-EG")
    : egp.toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** piastres → "1,234 جنيه" */
export function fmtE(p: number | null | undefined): string {
  return `${fmt(p)} جنيه`;
}

/** EGP float → piastres for input payloads */
export function egpToPiastres(v: string | number): number {
  const n = typeof v === "string" ? parseFloat(normalizeDigits(v).replace(/,/g, "")) : v;
  return Math.round((isFinite(n) ? n : 0) * 100);
}

export function balanceLabel(balance: number): { text: string; tone: "owe" | "credit" | "clear" } {
  if (balance < 0) return { text: `الطالب عليه ${fmtE(-balance)}`, tone: "owe" };
  if (balance > 0) return { text: `الطالب ليه رصيد ${fmtE(balance)}`, tone: "credit" };
  return { text: "الطالب سدّد كل حاجة", tone: "clear" };
}

// ============================= Session & status labels =============================

export const ATTENDANCE_LABEL: Record<string, string> = {
  PRESENT: "حاضر",
  LATE: "متأخر",
  EXCUSED: "بعذر",
};

export const EXPENSE_LABEL: Record<string, string> = {
  RENT: "إيجار",
  ELECTRICITY: "كهرباء",
  SALARIES: "مرتبات",
  MAINTENANCE: "صيانة",
  SUPPLIES: "مستلزمات",
  OTHER: "أخرى",
};

export const PAY_METHOD_LABEL: Record<string, string> = {
  CASH: "كاش",
  VODAFONE: "فودافون كاش",
  INSTAPAY: "انستاباي",
};

export const STUDENT_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "شغال", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PAUSED: { label: "متوقف مؤقتاً", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  ARCHIVED: { label: "مؤرشف", cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

export const TXN_LABEL: Record<string, { label: string; cls: string }> = {
  CHARGE: { label: "حصة", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  PAYMENT: { label: "دفع", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  REFUND: { label: "استرداد", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  ADJUSTMENT: { label: "تسوية", cls: "bg-sky-50 text-sky-700 border-sky-200" },
};

// ============================= Time helpers =============================

export function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function sessionPhase(startTime: string, endTime: string, ref = nowHM()): "past" | "now" | "future" {
  if (endTime < ref) return "past";
  if (startTime <= ref) return "now";
  return "future";
}

export const DAY_TABS = [
  { dow: 6, label: "السبت" },
  { dow: 0, label: "الأحد" },
  { dow: 1, label: "الاثنين" },
  { dow: 2, label: "الثلاثاء" },
  { dow: 3, label: "الأربعاء" },
  { dow: 4, label: "الخميس" },
  { dow: 5, label: "الجمعة" },
];

// ============================= Branding application =============================

// ===== Contrast math (WCAG) — بنحسب نسخ آمنة من ألوان الهوية لكل سنتر =====
function _h2r(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function _r2h(c: [number, number, number]): string {
  const p = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${p(c[0])}${p(c[1])}${p(c[2])}`;
}
function _mix(a: [number, number, number], b: [number, number, number], shareA: number): [number, number, number] {
  return [a[0] * shareA + b[0] * (1 - shareA), a[1] * shareA + b[1] * (1 - shareA), a[2] * shareA + b[2] * (1 - shareA)];
}
function _lum(c: [number, number, number]): number {
  const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function _contrast(a: [number, number, number], b: [number, number, number]): number {
  const l1 = _lum(a), l2 = _lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const WHITE_RGB: [number, number, number] = [255, 255, 255];
const BLACK_RGB: [number, number, number] = [0, 0, 0];
const APP_BG: [number, number, number] = _h2r("#f5f8fd");
const DARK_CARD: [number, number, number] = _h2r("#101a31");

/** أغمق نسخة من اللون تفضل ≥ target تباين مع كل الخلفيات الفاتحة (نص + خلفية صلبة بنص أبيض) */
export function darkenForAA(hex: string, target = 5): string {
  try {
    const rgb = _h2r(hex);
    for (let keep = 100; keep >= 10; keep--) {
      const m = _mix(rgb, BLACK_RGB, keep / 100);
      if (_contrast(m, WHITE_RGB) >= target && _contrast(m, APP_BG) >= target) return _r2h(m);
    }
    return _r2h(_mix(rgb, BLACK_RGB, 0.1));
  } catch { return hex; }
}

/** أفتح نسخة من اللون تفضل ≥ target تباين مع الأسطح الغامقة (نص في الدارك)
 *  بيتحقق ضد الكارت الغامق + كمان ضد السطح البراندي الغامق (24% لون + كارت)
 *  عشان نص البراند على كروت nk-brand-bg-soft / nk-brand-row يطلع مقروء برضه */
export function lightenForDarkAA(hex: string, target = 4.65): string {
  try {
    const rgb = _h2r(hex);
    const softDark = _mix(rgb, DARK_CARD, 0.26);
    for (let keep = 100; keep >= 10; keep--) {
      const m = _mix(rgb, WHITE_RGB, keep / 100);
      if (_contrast(m, DARK_CARD) >= target && _contrast(m, softDark) >= target) return _r2h(m);
    }
    return "#ffffff";
  } catch { return hex; }
}

/** الهوية الرسمية الافتراضية وموحّد الألوان عايشين في src/lib/branding.ts — وحدة محايدة
 *  (من غير "use client") عشان الـ APIs والطباعة توحّد ألوانها مع اللوجو هي كمان.
 *  هنا إعادة تصدير عشان كل الكلاينت القديم بيكمل يسيبورت من "./lib". */
export { BRAND_DEFAULTS, normalizeCenterBranding } from "@/lib/branding";
export type { BrandableCenter } from "@/lib/branding";

export function applyCenterBranding(center: BrandableCenter | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // القيم القديمة من الداتابيز بترجع لهوية اللوجو قبل التطبيق
  const c = normalizeCenterBranding(center);
  // الافتراضي = هوية AlNokhba Management الرسمية (كحلي + أزرق + تركواز من البراند شيت)
  const primary = c?.primaryColor || BRAND_DEFAULTS.primary;
  const secondary = c?.secondaryColor || BRAND_DEFAULTS.secondary;
  const accent = c?.accentColor || BRAND_DEFAULTS.accent;
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--ring", secondary);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--c-primary", primary);
  root.style.setProperty("--c-secondary", secondary);
  root.style.setProperty("--c-accent", accent);
  root.style.setProperty("--accent", `color-mix(in srgb, ${primary} 8%, #ffffff)`);
  root.style.setProperty("--accent-foreground", secondary);
  // نسخ آمنة للتباين (WCAG AA) — النص البراندي/الخلفيات الصلبة في الفاتح، ونص البراند في الدارك
  root.style.setProperty("--c-primary-strong", darkenForAA(primary, 5));
  root.style.setProperty("--c-secondary-strong", darkenForAA(secondary, 5));
  root.style.setProperty("--c-accent-strong", darkenForAA(accent, 5));
  root.style.setProperty("--c-primary-lift", lightenForDarkAA(primary, 4.6));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", primary);
}

/** text color that stays readable on the brand color */
export function readableOn(hex: string | null | undefined): string {
  const h = (hex ?? "#0B1B4F").replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0B1B4F" : "#ffffff";
}

// ============================= Misc =============================

/** جمع عربي مع الأعداد: ١ دقيقة / دقيقتين / ٥ دقايق / ١٥ دقيقة */
function unitAR(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}

export function timeAgoAR(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "الآن";
  if (diff < 3600) return `من ${unitAR(Math.floor(diff / 60), "دقيقة", "دقيقتين", "دقايق")}`;
  if (diff < 86400) return `من ${unitAR(Math.floor(diff / 3600), "ساعة", "ساعتين", "ساعات")}`;
  return `من ${unitAR(Math.floor(diff / 86400), "يوم", "يومين", "أيام")}`;
}
