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
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // الكاميرا مسموحة (self) بس — مطلوبة لماسح QR؛ الباقي مقفول
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
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
