import type { Metadata } from "next";
import { ZakiPreview } from "@/components/zaki/zaki-preview";

/* معاينة بصرية لشخصية زكي — Demo Only.
   صفحة اختبار الهوية البصرية: مفيش بيانات حقيقية، مفيش اتصال سيرفر،
   مفيش فهرسة (noindex + robots.txt PRIVATE_PATHS)، ومفيش لينك فيها في المنيو. */
export const metadata: Metadata = {
  title: "Zaki Visual Prototype — Demo Only",
  description: "عرض بصري تجريبي لشخصية زكي في AlNokhba Management — بيئة اختبار فقط بدون أي بيانات أو اتصال.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ZakiPreviewPage() {
  return <ZakiPreview />;
}
