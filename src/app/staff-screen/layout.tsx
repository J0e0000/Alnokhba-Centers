import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

export const metadata: Metadata = privateLayoutMetadata("شاشة حضور الموظفين");

export default function StaffScreenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
