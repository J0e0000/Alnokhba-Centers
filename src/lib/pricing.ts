/* ============================================================
   محرك تسعير الاشتراكات — نخبة سنترز (SaaS pricing)
   الأسعار المعتمدة من صاحب المنتج (2026-08-27):
   - أساسي: 600 جنيه/شهر شامل أول 100 طالب
   - الطالب 101–1,000:   4.00 جنيه/طالب
   - الطالب 1,001–2,000: 3.00 جنيه/طالب
   - الطالب 2,001–3,000: 2.50 جنيه/طالب
   - الطالب 3,001–10,000: 1.75 جنيه/طالب
   العدّ = كل الطلاب المسجلين غير الأرشيف (أونلاين أو داخل السنتر).
   كل المبالغ بالقروش (piastres) زي باقي النظام.

   اختبارات محسوبة يدويًا (EGP/شهر):
   100 → 600 | 500 → 2,200 | 1,000 → 4,200
   2,000 → 7,200 | 3,000 → 9,700 | 10,000 → 21,950
============================================================ */

export const PRICING = {
  baseMonthly: 60_000, // 600 EGP — piastres
  baseIncludedStudents: 100,
  hardLimitStudents: 10_000,
  warnRatio80: 0.8,
  warnRatio95: 0.95,
  tiers: [
    { from: 101, to: 1_000, unit: 400, label: "من 101 لـ 1,000 طالب" },
    { from: 1_001, to: 2_000, unit: 300, label: "من 1,001 لـ 2,000 طالب" },
    { from: 2_001, to: 3_000, unit: 250, label: "من 2,001 لـ 3,000 طالب" },
    { from: 3_001, to: 10_000, unit: 175, label: "من 3,001 لـ 10,000 طالب" },
  ],
} as const;

export type PricingTierRow = {
  label: string;
  count: number;
  unit: number; // piastres
  subtotal: number; // piastres
};

export type PricingBreakdown = {
  students: number; // billed student count (non-archived)
  baseMonthly: number;
  baseIncludedStudents: number;
  tiers: PricingTierRow[];
  total: number; // piastres / month
  avgPerStudent: number; // piastres (0 when no students)
  nextStudentUnit: number; // piastres — cost of ONE additional student
  usageRatio: number; // students / hardLimit (0..1+)
  warnLevel: "NONE" | "WARN_80" | "WARN_95" | "LIMIT";
};

/** الفاتورة الشهرية بالقروش لعدد طلاب معيّن (صحة: أي عدد >= 0). */
export function monthlyBillPiastres(students: number): number {
  const n = Math.max(0, Math.floor(Number(students) || 0));
  let total = PRICING.baseMonthly;
  for (const t of PRICING.tiers) {
    const count = Math.max(0, Math.min(n, t.to) - (t.from - 1));
    total += count * t.unit;
  }
  return total;
}

/** تفصيل الفاتورة صف-صف (للشفافية في لوحة الأدمن). */
export function pricingBreakdown(students: number): PricingBreakdown {
  const n = Math.max(0, Math.floor(Number(students) || 0));
  const tiers: PricingTierRow[] = PRICING.tiers.map((t) => {
    const count = Math.max(0, Math.min(n, t.to) - (t.from - 1));
    return { label: t.label, count, unit: t.unit, subtotal: count * t.unit };
  });
  const total = monthlyBillPiastres(n);
  const usageRatio = n / PRICING.hardLimitStudents;
  const nextTier =
    n < PRICING.baseIncludedStudents
      ? 0 // داخل الباقة الأساسية — الطالب الجاي مجاني
      : PRICING.tiers.find((t) => n < t.to) ?? PRICING.tiers[PRICING.tiers.length - 1];
  return {
    students: n,
    baseMonthly: PRICING.baseMonthly,
    baseIncludedStudents: PRICING.baseIncludedStudents,
    tiers,
    total,
    avgPerStudent: n > 0 ? Math.round(total / n) : 0,
    nextStudentUnit: nextTier ? nextTier.unit : 0,
    usageRatio,
    warnLevel:
      n >= PRICING.hardLimitStudents ? "LIMIT"
      : usageRatio >= PRICING.warnRatio95 ? "WARN_95"
      : usageRatio >= PRICING.warnRatio80 ? "WARN_80"
      : "NONE",
  };
}
