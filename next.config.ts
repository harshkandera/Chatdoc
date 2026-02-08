import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  allowedDevOrigins: [
    "telically-breathy-jinny.ngrok-free.dev",
    "*.ngrok-free.dev",
  ],
  devIndicators: false,
};
export default nextConfig;
