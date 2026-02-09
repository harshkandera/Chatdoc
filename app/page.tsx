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

export default function Home() {
  return (
    <div className="relative min-h-screen dark noise-overlay">
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
