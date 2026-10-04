import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

/* صفحة توكن مؤقتة (حضور عام بقفل الجهاز) — noindex بتصريح */
export const metadata: Metadata = privateLayoutMetadata("تسجيل الحضور");

export default function ALayout({ children }: { children: React.ReactNode }) {
  return children;
}
