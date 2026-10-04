import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

export const metadata: Metadata = privateLayoutMetadata("تسجيل الدخول");

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
