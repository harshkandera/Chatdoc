import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://chatdoc.ai";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/chat", "/api", "/settings", "/success"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
