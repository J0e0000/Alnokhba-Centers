import type { Metadata } from "next";

/* ============================================================
   SEO المركزي — مصدر الحقيقة الوحيد للهوية والروابط والبيانات
   الوصفية (metadata) في الموقع كله. أي صفحة عايزة title/description/
   canonical/OG بتستدعي pageMetadata() بدل ما تكتب JSON يدوي.
   ─────────────────────────────────────────────────────────────
   القواعد:
   - اسم الموقع الرسمي: Alnokhba Managment (هوية المنصة الموحدة).
   - الدومين الكانوني من NEXT_PUBLIC_SITE_URL، والافتراضي دومين
     الإنتاج الفعلي على Vercel.
   - ممنوع اختراع صفحات/منتجات غير موجودة — الموقع العام الوحيد
     حاليًا هو صفحة الهبوط «/».
============================================================ */

export const SITE_NAME = "Alnokhba Managment";

/** الوصف الرسمي للمنصة — مطابق لمحتوى صفحة الهبوط فعليًا */
export const SITE_DESCRIPTION =
  "منصة إدارة السنترات التعليمية: حضور بالـ QR، حسابات ودفعات بالقروش، اشتراكات، مستحقات المدرسين، بورتال للطالب وبورتال للمدرس، ووضع طوارئ أوفلاين — كل حاجة في مكان واحد.";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://alnokhba-centers.vercel.app"
).replace(/\/+$/, "");

/** الصفحات العامة القابلة للفهرسة — حافظ عليها متزامنة مع sitemap و robots و llms.txt */
export const PUBLIC_PATHS = ["/"] as const;

/** صفحات خاصة/بتوكينات — noindex + Disallow في robots (مش بديل عن المصادقة) */
export const PRIVATE_PATHS = [
  "/login",
  "/app",
  "/portal",
  "/teacher",
  "/staff-screen",
  "/academia",
  "/s/",
  "/a/",
  "/c/",
] as const;

/* ------------------------------------------------------------
   بُناء الـ metadata لصفحة واحدة — title/description/canonical/OG/Twitter
   path مثال: "/" أو "/login" (بس للـ canonical — الصفحات الخاصة noindex)
------------------------------------------------------------ */
export function pageMetadata(opts: {
  title?: string;
  description?: string;
  path?: string;
  noindex?: boolean;
  ogImageAlt?: string;
}): Metadata {
  const title = opts.title ? `${opts.title} | ${SITE_NAME}` : `${SITE_NAME} — منصة إدارة السنترات التعليمية`;
  const description = opts.description ?? SITE_DESCRIPTION;
  const path = opts.path ?? "/";
  const canonical = `${SITE_URL}${path === "/" ? "" : path}`;
  const ogImage = { url: "/og.jpg", width: 1200, height: 630, alt: opts.ogImageAlt ?? `${SITE_NAME} — منصة إدارة السنترات التعليمية` };

  return {
    title: { absolute: title }, // absolute — يمنع تطبيق template الـ layout مرتين
    description,
    alternates: opts.noindex ? undefined : { canonical },
    robots: opts.noindex
      ? { index: false, follow: false, nocache: true }
      : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ar_EG",
      url: canonical,
      title,
      description,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.jpg"],
    },
  };
}

/* ------------------------------------------------------------
   ميتاداتا الصفحات الخاصة (تتطلب دخول / صفحات توكنات مؤقتة):
   noindex + nofollow — عشان مفيش صفحة خاصة تتخزن في محركات البحث،
   مع title واضح للتاب في المتصفح. المصادقة نفسها في الـ API (robots مش حماية).
------------------------------------------------------------ */
export function privateLayoutMetadata(title: string): Metadata {
  return {
    title: { absolute: `${title} | ${SITE_NAME}` },
    robots: { index: false, follow: false, nocache: true },
  };
}

/* ------------------------------------------------------------
   JSON-LD — بيانات منظمة مطابقة لما ظاهر فعلًا على صفحة الهبوط
   (ممنوع الـ schema المفبرك: مفيش SearchAction لمفيش بحث عام،
   ومفيش FAQPage لمفيش أسئلة شائعة ظاهرة)
------------------------------------------------------------ */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/logo.png`,
      width: 320,
      height: 320,
    },
    description: SITE_DESCRIPTION,
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    inLanguage: "ar",
    publisher: { "@type": "Organization", name: SITE_NAME, url: `${SITE_URL}/` },
  };
}

/** المنتج الوحيد الموثق في صفحة الهبوط: نظام تشغيل السنترات (تطبيق ويب) */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
    inLanguage: "ar",
    featureList: [
      "حضور الطلاب بالـ QR",
      "حسابات ودفعات وإيصالات",
      "اشتراكات وتجديد",
      "مستحقات المدرسين",
      "بورتال طالب وبورتال مدرس",
      "وضع طوارئ أوفلاين",
    ],
  };
}
