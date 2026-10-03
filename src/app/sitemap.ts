import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_PATHS } from "@/lib/seo";

/* sitemap.xml ديناميكي — بس الصفحات العامة الفعلية.
   ممنوع يضاف: الداشبورد، البورتالات، صفحات الدخول، الـ API،
   صفحات التوكنات المؤقتة (/s /a /c)، وصفحات noindex.
   لما يضاف منتج أو صفحة عامة جديدة → تتضاف في PUBLIC_PATHS في seo.ts. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: path === "/" ? 1 : 0.8,
  }));
}
