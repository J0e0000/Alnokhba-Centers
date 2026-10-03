import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

/* صفحة توكن مؤقتة (حضور الموظف) — noindex بتصريح */
export const metadata: Metadata = privateLayoutMetadata("حضور الموظف");

export default function CLayout({ children }: { children: React.ReactNode }) {
  return children;
}
