import type { Metadata } from "next";
import UxLab from "@/components/ux-lab/lab-root";

/* مختبر تدفّق الحصة — بيئة تجربة معزولة تمامًا:
   - كله client-side ببيانات اصطناعية، صفر استدعاءات API، صفر كتابة على أي بيانات حقيقية.
   - noindex + مستثناة من الـ sitemap/robots (PRIVATE_PATHS في src/lib/seo.ts).
   - الهدف: المقارنة بين بدائل تدفّق الجلسة وتسجيل اختيار المالك. */
export const metadata: Metadata = {
  title: "مختبر تدفّق الحصة — النخبة",
  description: "بيئة تجربة معزولة لمقارنة 3 تدفقات تشغيلية للحصة (سريعة / مُوجَّهة / قمرة قيادة) ببيانات اصطناعية بالكامل.",
  robots: { index: false, follow: false, nocache: true },
};

export default function Page() {
  return <UxLab />;
}
