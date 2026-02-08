"use client";

import { Quote } from "lucide-react";

const testimonials = [
  {
    quote:
      "Finally, I can get accurate answers from documentation without scrolling through pages. ChatDoc reduced our onboarding time by 60%.",
    name: "Sarah Chen",
    role: "Staff Engineer",
    company: "Vercel",
  },
  {
    quote:
      "The confidence scoring is brilliant. I know exactly when to trust an answer and when to dig deeper into the source docs.",
    name: "Marcus Johnson",
    role: "Tech Lead",
    company: "Stripe",
  },
  {
    quote:
      "We indexed our entire API documentation. Now support tickets are resolved in minutes, not hours. Game changer.",
    name: "Elena Rodriguez",
    role: "Developer Advocate",
    company: "Supabase",
  },
];

export function TestimonialsSection() {
  return (
    <section className="border-b border-white/5 bg-black py-20 relative">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 spotlight-grid">
          {testimonials.map((testimonial, i) => (
            <div
              key={i}
              className="spotlight-card p-8 border border-white/5 bg-neutral-900/10 backdrop-blur hover:bg-neutral-900/20 transition-colors relative"
            >
              <Quote className="text-neutral-700 w-8 h-8 mb-4" />
              <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
                &quot;{testimonial.quote}&quot;
              </p>
              <div className="flex items-center gap-3 relative z-10">
                <div className="w-8 h-8 bg-neutral-800 rounded-full overflow-hidden flex items-center justify-center">
                  <span className="text-xs font-bold text-white">
                    {testimonial.name[0]}
                  </span>
                </div>
                <div>
                  <div className="text-white text-xs font-medium">
                    {testimonial.name}
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono">
                    {testimonial.role} @ {testimonial.company}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
