import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Google profile pictures (OAuth)
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Clerk hosted avatars
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.dev" },
      // GitHub avatars
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  allowedDevOrigins: [
    "telically-breathy-jinny.ngrok-free.dev",
    "*.ngrok-free.dev",
  ],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking protection (#7)
          { key: "X-Frame-Options", value: "DENY" },
          // MIME-sniffing protection (#7)
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer leakage reduction (#7)
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // HSTS — force HTTPS for 2 years (#7)
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Content-Security-Policy (#7)
          // 'unsafe-inline' for styles/scripts is required by Next.js RSC and Clerk.
          // Tighten further with nonces once you have a custom document.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.com https://*.clerk.accounts.dev https://clerk.thechatdoc.online https://js.intercomcdn.com https://cdn.jsdelivr.net https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' blob: data: https:",
              "connect-src 'self' https://api.clerk.com https://*.clerk.accounts.dev https://clerk.thechatdoc.online https://accounts.thechatdoc.online https://api.groq.com https://generativelanguage.googleapis.com https://api.openai.com https://api.pinecone.io https://*.pinecone.io https://*.unicornplatform.com https://unicornstudio.b-cdn.net https://*.b-cdn.net https://storage.googleapis.com wss:",
              "media-src 'self' https://cdn.coverr.co blob:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
export default nextConfig;
