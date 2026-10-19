import type { NextConfig } from "next";

// ===== security headers (تتطبق على كل المسارات) =====
// CSP عملية: 'unsafe-inline' للسكريبتات/الستايلات مطلوبة لـ Next.js runtime —
// لكنها بتمنع أي سكريبت/ستايل خارجي تمامًا (XSS خارجي مستحيل عمليًا).
const dev = process.env.NODE_ENV === "development";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  // الشاشات المدمجة (معاينة الشات/الويب فيو) مسموحة — كان DENY بيمنع الاستخدام من أي لوحة مدمجة
  // وخلّي المستخدم يفتكر إن النظام «بيسجّله خروج فورًا» (الكوكي Third-party مش بيوصل)
  // التطوير بيسمح بـ http://localhost:* عشان اختبار التضمين محليًا — الإنتاج https بس
  `frame-ancestors 'self' http://localhost:* https:`,
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // X-Frame-Options اتشال — frame-ancestors فوق بتغطيه، وبوجوده مع CSP بيكسر التضمين
  // في المحركات اللي بتحترم XFO قبل CSP (الحماية من clickjacking زي ما هي عبر frame-ancestors)
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // الكاميرا والميكروفون مسموحين (self) — ماسح QR + إدخال Zaki الصوتي.
  // microphone=() كانت بتقفل الميكروفون على مستوى المتصفح حتى لو المستخدم وافق — ده كان سبب فشل الصوت
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // بصمة الإصدار: بتتعرض في الإعدادات عشان المدير يقدر يتأكد إن آخر تحديث
  // وصل فعلاً لجهازه (شكوى «التحديثات مبتوصلش») — VERCEL_GIT_COMMIT_SHA
  // بيحطه Vercel وقت البناء، ومحليًا بنرجع لآخر commit SHA.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      (process.env.NODE_ENV === "development" ? "dev" : "local"),
  },
  // Turbopack: ثبّت جذر الـ workspace صراحة — من غيره dev بيفشل أحيانًا لما
  // ميلاقي next/package.json من جوه src/app (بيحصل مع الـ sandbox layout)
  turbopack: {
    root: __dirname,
  },
  // ملاحظة أمان: قاعدة بيانات SQLite التجريبية مبقتش تتضمن في باندل السيرفرلس —
  // الإنتاج بيستخدم Postgres دايمًا (DATABASE_URL)، والبناء المحلي بينسخ db/
  // جوا standalone بنفسه (سطر cp في package.json).
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // المؤشر العائم بتاع أدوات التطوير بيغطي زر «المزيد» في وضع dev ويكسر الاختبارات — تعطيله
  devIndicators: false,
  // ⚡ استرداد مساحة Vercel (deployment/functions storage):
  // ملفات مش بيحتاجها الـ serverless وقت التشغيل كانت بتتفحص جوه function bundles:
  //   • db/custom.db (28.6MB — SQLite محلي؛ الإنتاج postgres عن طريق DATABASE_URL دايمًا)
  //   • scripts/ (~14MB وسائط تدقيق تاريخية: PDF/PNG مش من التطبيق)
  //   • typescript (20MB — مفيش أي كود runtime بيستخدم الـ compiler)
  //   • مجلدات الساندبوكس (skills/backups/upload/download) لو حصلت في سياق بناء
  // القراءة كلها في الكود إما مش موجودة أصلًا أو محمية بـ existsSync/try-catch،
  // وvercel-build.sh بيشتغل في مرحلة البناء (مش runtime) فمش بيتأثر.
  // ملاحظة: sharp/@img بيتسابوا محليًا (next/image optimizer محلي) — استبعادهم من
  // Vercel محتاج تحقق منفصل على الـ image optimizer بتاع المنصة (مقترح موثق في التقرير).
  outputFileTracingExcludes: {
    "*": [
      "./db/*.db",
      "./scripts/**/*.pdf",
      "./scripts/**/*.png",
      "./scripts/**/*.jpg",
      "./skills/**/*",
      "./backups/**/*",
      "./upload/**/*",
      "./download/**/*",
      "./examples/**/*",
      "./node_modules/typescript/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // نماذج التصميم (public/prototypes/*.html) — روابط نضيفة من غير .html:
  // /prototypes → صفحة المقارنة · /prototypes/1 → النموذج الأول … إلخ
  // afterFiles (الافتراضي): الملف الثابت بيتقدم الأول — الـ rewrite بيشتغل بس لو مفيش ملف.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/prototypes", destination: "/prototypes/index.html" },
        { source: "/prototypes/:slug", destination: "/prototypes/:slug.html" },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
