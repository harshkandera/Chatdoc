import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { LogoMarquee } from "@/components/LogoMarquee";
import { FeaturesSection } from "@/components/FeaturesSection";
import { TechStackSection } from "@/components/TechStackSection";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { PricingSection } from "@/components/PricingSection";
import { CTASection } from "@/components/CTASection";
import { Footer } from "@/components/Footer";
import { AuraBackground } from "@/components/AuraBackground";

export const metadata: Metadata = {
  title: "ChatDoc — Chat with Your Documentation Using AI",
  description:
    "Index any technical documentation and chat with it instantly. ChatDoc uses AI-powered RAG to deliver accurate, sourced answers from your indexed docs.",
  openGraph: {
    title: "ChatDoc — Chat with Your Documentation Using AI",
    description:
      "Index any documentation and get instant AI-powered answers. Accurate, sourced, and verified.",
    images: [
      {
        url: "/api/og?title=Chat with Your Documentation",
        width: 1200,
        height: 630,
        alt: "ChatDoc — Chat with Your Documentation Using AI",
      },
    ],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ChatDoc",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  description:
    "AI-powered documentation chat tool that lets you index technical docs and get accurate, sourced answers instantly.",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "USD",
    lowPrice: "0",
    highPrice: "19",
    offerCount: "2",
  },
  featureList: [
    "AI-powered documentation chat",
    "RAG-based sourced answers",
    "Multi-provider LLM support",
    "Documentation indexing",
    "Workspace management",
  ],
};

export default function Home() {
  return (
    <div className="relative min-h-screen dark noise-overlay">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Animated Purple/Blue Aura Background */}
      <AuraBackground />

      {/* Technical Grid Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 technical-grid opacity-30"></div>

      {/* Vertical Structure Lines */}
      <div className="fixed inset-0 pointer-events-none z-0 max-w-[1400px] mx-auto border-x border-white/[0.04]">
        <div className="absolute left-1/4 h-full w-px bg-white/[0.02]"></div>
        <div className="absolute left-2/4 h-full w-px bg-white/[0.02]"></div>
        <div className="absolute left-3/4 h-full w-px bg-white/[0.02]"></div>
      </div>

      {/* Navigation */}
      <Navbar />

      {/* Main Content */}
      <main className="relative z-10 pt-20">
        <HeroSection />
        <LogoMarquee />
        <FeaturesSection />
        <TechStackSection />
        <HowItWorksSection />
        <PricingSection />
        <TestimonialsSection />
        <CTASection />
        <Footer />
      </main>
    </div>
  );
}
