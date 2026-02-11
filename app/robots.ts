import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://www.thechatdoc.online";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/og"],
        disallow: ["/chat", "/api", "/settings", "/success"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
