import { LandingPage } from "@/components/nokhba/landing";
import { pageMetadata, organizationJsonLd, websiteJsonLd, softwareApplicationJsonLd } from "@/lib/seo";

/* صفحة الهبوط — الواجهة العامة الوحيدة القابلة للفهرسة.
   Server Component عشان الـ metadata والـ JSON-LD يتولدوا سيرفر سايد،
   والمحتوى نفسه (LandingPage) بيفضل SSR كامل في الـ HTML الأولي. */

export const metadata = pageMetadata({
  description:
    "Alnokhba Managment بيجمع الطلاب والمدرسين والحصص والحضور والدفعات والاشتراكات في نظام واحد بسيط: حضور بالـ QR في ثواني، إيصالات ومحفظة، اشتراكات، مستحقات مدرسين، وبورتال للطالب والمدرس — مع وضع طوارئ أوفلاين.",
  path: "/",
  ogImageAlt: "Alnokhba Managment — لوحة تشغيل السنتر التعليمي",
});

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd()) }}
      />
      <LandingPage />
    </>
  );
}
