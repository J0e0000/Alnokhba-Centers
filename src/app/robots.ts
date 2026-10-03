import type { MetadataRoute } from "next";
import { SITE_URL, PRIVATE_PATHS } from "@/lib/seo";

/* robots.txt ديناميكي — مصدره نفس قائمة المسارات الخاصة في seo.ts.
   ⚠️ robots.txt أداة زحف مش أداة أمن: الحماية الفعلية للمسارات الخاصة
   هي المصادقة والتفويض في الـ API — هنا بنخلي الزحف نظيف بس. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...PRIVATE_PATHS, "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
