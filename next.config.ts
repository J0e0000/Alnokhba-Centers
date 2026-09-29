import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Serverless (Vercel): the runtime DB-path fallback resolves db/custom.db
  // dynamically, which the file tracer can't see — force-include it in every
  // function bundle so the demo DB works even before a Postgres URL is set.
  outputFileTracingIncludes: {
    "/**": ["./db/custom.db"],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // المؤشر العائم بتاع أدوات التطوير بيغطي زر «المزيد» في وضع dev ويكسر الاختبارات — تعطيله
  devIndicators: false,
};

export default nextConfig;
