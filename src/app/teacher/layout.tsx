import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

export const metadata: Metadata = privateLayoutMetadata("بورتال المدرس");

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
