import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

/* تطبيق الأكاديميا (شامل session/[id]) — noindex بتصريح */
export const metadata: Metadata = privateLayoutMetadata("Alnokhba Academia");

export default function AcademiaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
