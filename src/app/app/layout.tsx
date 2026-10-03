import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

export const metadata: Metadata = privateLayoutMetadata("نظام السنتر");

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
