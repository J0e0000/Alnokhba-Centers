import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { PWARegister } from "@/components/nokhba/pwa";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL } from "@/lib/seo";

/* تحقق Google Search Console — اختياري وآمن:
   لو المالك ضاف GOOGLE_SITE_VERIFICATION في متغيرات البيئة على Vercel
   بيتحقق تلقائيًا من غير ما نكشف أي سر في الكود. من غيره الموقع شغال عادي
   والمالك يتحقق بطريقة ملف HTML أو DNS (موثقة في تقرير SEO). */
const GOOGLE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || undefined;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — منصة إدارة السنترات التعليمية`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  icons: {
    icon: [
      { url: "/favicon.png?v=2", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png?v=2",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ar_EG",
    url: `${SITE_URL}/`,
    title: `${SITE_NAME} — منصة إدارة السنترات التعليمية`,
    description: SITE_DESCRIPTION,
    images: [{ url: "/og.jpg?v=2", width: 1200, height: 630, alt: `${SITE_NAME} — منصة إدارة السنترات التعليمية` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — منصة إدارة السنترات التعليمية`,
    description: SITE_DESCRIPTION,
    images: ["/og.jpg?v=2"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  ...(GOOGLE_VERIFICATION ? { verification: { google: GOOGLE_VERIFICATION } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // اسمح بالزوم لعين متعبة — بس مش أكثر من 5x
  // ضروري للآيفون: بدونه env(safe-area-inset-*) بترجع صفر والناف السفلي بيقع تحت الـ home indicator
  viewportFit: "cover",
  themeColor: "#0B1B4F",
};

/* سكربت ما قبل الترطيب — يطبق الوضع المحفوظ قبل أول رسم (يمنع الوميض).
   الوضع الداكن لتجربة السنتر التشغيلية بس — البوابات التانية مقفولة على الفاتح. */
const THEME_INIT = `try{var t=localStorage.getItem('nk-theme');if(t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* تحميل مسبق لخطوط Cairo الذاتية — LCP أسرع لأول رسم نصي */}
        <link rel="preload" href="/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/cairo-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
        <Toaster richColors position="top-center" dir="rtl" closeButton />
        <PWARegister />
      </body>
    </html>
  );
}
