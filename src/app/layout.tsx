import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { PWARegister } from "@/components/nokhba/pwa";

export const metadata: Metadata = {
  title: "نخبة سنترز | AlNokhba Centers",
  description: "نظام إدارة السنترات — حضور، حسابات، ومتابعة الطلاب من غير وجع دماغ",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  applicationName: "نخبة سنترز",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // اسمح بالزوم لعين متعبة — بس مش أكثر من 5x
  // ضروري للآيفون: بدونه env(safe-area-inset-*) بترجع صفر والناف السفلي بيقع تحت الـ home indicator
  viewportFit: "cover",
  themeColor: "#143159",
};

/* سكربت ما قبل الترطيب — يطبق الوضع المحفوظ قبل أول رسم (يمنع الوميض).
   الوضع الداكن لتجربة السنتر التشغيلية بس — البوابات التانية مقفولة على الفاتح. */
const THEME_INIT = `try{var t=localStorage.getItem('nk-theme');if(t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
        <Toaster richColors position="top-center" dir="rtl" closeButton />
        <PWARegister />
      </body>
    </html>
  );
}
