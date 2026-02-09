import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChatDoc - AI-Powered Documentation Chat",
  description:
    "Chat directly with verified technical documentation. Get accurate, sourced answers from your indexed docs.",
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
        <ClerkProvider
          appearance={{
            variables: {
              colorBackground: "#000000",
              colorText: "#ffffff",
              colorTextSecondary: "#a3a3a3",
              colorPrimary: "#6c47ff",
              colorDanger: "#ef4444",
              borderRadius: "0.75rem",
              fontSize: "0.875rem", // 🔥 smaller overall UI
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
        <Analytics />
      </body>
    </html>
  );
}
