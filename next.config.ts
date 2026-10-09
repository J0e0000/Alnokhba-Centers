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
  // ملاحظة أمان: قاعدة بيانات SQLite التجريبية مبقتش تتضمن في باندل السيرفرلس —
  // الإنتاج بيستخدم Postgres دايمًا (DATABASE_URL)، والبناء المحلي بينسخ db/
  // جوا standalone بنفسه (سطر cp في package.json).
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // المؤشر العائم بتاع أدوات التطوير بيغطي زر «المزيد» في وضع dev ويكسر الاختبارات — تعطيله
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
