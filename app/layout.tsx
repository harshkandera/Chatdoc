import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://www.thechatdoc.online";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: "ChatDoc — AI-Powered Documentation Chat",
    template: "%s | ChatDoc",
  },
  description:
    "Chat directly with verified technical documentation. Get accurate, sourced answers from your indexed docs using AI-powered RAG.",
  keywords: [
    "AI documentation chat",
    "chat with docs",
    "AI-powered documentation assistant",
    "documentation search AI",
    "technical docs chatbot",
    "indexed documentation chat",
    "ChatDoc AI",
    "RAG documentation tool",
    "AI doc search",
    "developer documentation assistant",
  ],
  authors: [{ name: "ChatDoc" }],
  creator: "ChatDoc",
  publisher: "ChatDoc",
  verification: {
    google: "wsO-pDAJdTQCwDY4dFg3KJuvia8DlhdTZUQV0XIiiRQ",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "ChatDoc",
    title: "ChatDoc — AI-Powered Documentation Chat",
    description:
      "Chat directly with verified technical documentation. Get accurate, sourced answers from your indexed docs.",
    images: [
      {
        url: `${siteUrl}/api/og?title=ChatDoc`,
        width: 1200,
        height: 630,
        alt: "ChatDoc — AI-Powered Documentation Chat",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ChatDoc — AI-Powered Documentation Chat",
    description:
      "Chat directly with verified technical documentation. Get accurate, sourced answers from your indexed docs.",
    images: [`${siteUrl}/api/og?title=ChatDoc`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-black text-white`}
      >
        <TooltipProvider>
          <ClerkProvider
            appearance={{
              variables: {
                colorBackground: "#000000",
                colorText: "#ffffff",
                colorTextSecondary: "#a3a3a3",
                colorPrimary: "#6c47ff",
                colorDanger: "#ef4444",
                borderRadius: "0.75rem",
                fontSize: "0.875rem",
              },
              elements: {
                card: "bg-black border border-white/10 shadow-xl",
                navbar: "bg-black border-b border-white/10",
                navbarButton: "text-neutral-300 hover:text-white",
                headerTitle: "text-white",
                headerSubtitle: "text-neutral-400",

                formButtonPrimary:
                  "bg-[#6c47ff] hover:bg-[#5a3be0] text-white rounded-lg",

                formFieldInput:
                  "bg-black border border-white/10 text-white focus:ring-[#6c47ff]",

                footer: "hidden",
              },
            }}
          >
            {children}
          </ClerkProvider>
        </TooltipProvider>
        <Analytics />
        <Toaster />
      </body>
    </html>
  );
}
