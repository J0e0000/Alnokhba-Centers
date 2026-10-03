import type { Metadata } from "next";
import { privateLayoutMetadata } from "@/lib/seo";

export const metadata: Metadata = privateLayoutMetadata("بورتال الطالب");

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
