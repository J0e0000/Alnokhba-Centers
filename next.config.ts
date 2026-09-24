import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // المؤشر العائم بتاع أدوات التطوير بيغطي زر «المزيد» في وضع dev ويكسر الاختبارات — تعطيله
  devIndicators: false,
};

export default nextConfig;
