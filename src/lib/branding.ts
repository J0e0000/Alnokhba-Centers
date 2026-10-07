/** هوية AlNokhba Management الرسمية — وحدة محايدة بتشتغل من السيرفر والكلاينت
 *  (من غير "use client") عشان أي API أو طباعة تقدر توحّد ألوانها مع اللوجو.
 *  المصدر: اللوجو الرسمي — كحلي #0B1B4F · أزرق #2563EB · تركواز #10B981 */

/** الهوية الرسمية الافتراضية — مصدر واحد للحقيقة (شاشة + طباعة + بورتال + أكاديميا + APIs). */
export const BRAND_DEFAULTS = { primary: "#0B1B4F", secondary: "#2563EB", accent: "#10B981" } as const;

/** الشكل الأدنى اللي محرك الهوية بيقراه — البورتالات بتوصل نسخة مصغّرة من CenterInfo */
export type BrandableCenter = {
  primaryColor?: string | null; secondaryColor?: string | null; accentColor?: string | null;
};

/** الافتراضيات القديمة اللي كانت بتتكتب في الداتابيز قبل هوية اللوجو (أخضر + تيل + عنبري).
 *  أي سنتر لسه شايل التوليفة دي بالظبط بيتعامل معاه كأنه مخصصش ألوان خالص. */
const LEGACY_DEFAULTS = { primary: "#0E9F6E", secondary: "#0F766E", accent: "#F59E0B" } as const;

const eqHex = (a: string | null | undefined, b: string) =>
  !!a && a.replace("#", "").toLowerCase() === b.replace("#", "").toLowerCase();

/** توحيد هوية السنتر مع اللوجو: القيم الافتراضية القديمة (اللي اتولدت قبل البراند شيت)
 *  بترجع لهوية AlNokhba الرسمية (كحلي/أزرق/تركواز) — عشان السنترات القديمة في الداتابيز
 *  تشوف هوية اللوجو من غير هجرة داتا، وأي تخصيص حقيقي بيفضل زي ما هو.
 *  بتستخدم في كل سطح بيتنفس ألوان السنتر: applyCenterBranding + الإعدادات + الطباعة. */
export function normalizeCenterBranding<T extends BrandableCenter>(center: T | null | undefined): T | null | undefined {
  if (!center) return center;
  // التوليفة القديمة الكاملة (أساسي + ثانوي) هي بصمة "مفيش تخصيص" — التخصيص الحقيقي بيبان في الفرق
  if (!(eqHex(center.primaryColor, LEGACY_DEFAULTS.primary) && eqHex(center.secondaryColor, LEGACY_DEFAULTS.secondary))) return center;
  const fixed = { ...center };
  fixed.primaryColor = BRAND_DEFAULTS.primary;
  fixed.secondaryColor = BRAND_DEFAULTS.secondary;
  if (eqHex(center.accentColor, LEGACY_DEFAULTS.accent)) fixed.accentColor = BRAND_DEFAULTS.accent;
  return fixed;
}
