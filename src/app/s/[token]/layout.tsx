import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

/* صفحة توكن مؤقتة (حضور ذاتي بالـ QR) — noindex بتصريح */
export const metadata: Metadata = privateLayoutMetadata("تسجيل الحضور الذاتي");

export default function SLayout({ children }: { children: React.ReactNode }) {
  return children;
}
