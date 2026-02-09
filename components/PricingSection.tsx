"use client";

import { Check, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const plans = [
  {
    name: "Starter",
    price: "$0",
    period: "/mo",
    description: "Perfect for hobby projects and experimentation.",
    features: [
      "1 Documentation Source",
      "Basic Chat Interface",
      "Standard Support",
      "Community Access",
    ],
    cta: "Start for Free",
    href: "/chat",
    popular: false,
    color: "neutral",
  },
  {
    name: "Pro",
    price: "$19",
    period: "/mo",
    description: "For serious developers building production apps.",
    features: [
      "10 Documentation Sources",
      "Priority Indexing",
      "Advanced RAG Features",
      "Priority Support",
      "Early Access to Features",
    ],
    cta: "Upgrade to Pro",
    href: `/api/checkout?products=${process.env.NEXT_PUBLIC_POLAR_PRICE_ID || ""}`,
    popular: true,
    color: "emerald",
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "/quote",
    description: "Tailored solutions for large teams.",
    features: [
      "Unlimited Sources",
      "Dedicated Slack Channel",
      "SSO & Custom Security",
      "SLA Contracts",
    ],
    cta: "Contact Sales",
    href: "mailto:sales@chatdoc.com",
    popular: false,
    color: "neutral",
  },
];

export function PricingSection() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section
      id="pricing"
      className="py-32 bg-black border-b border-white/5 relative"
    >
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Header with Toggle */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-20 gap-8">
          <div>
            <div className="text-[11px] font-mono text-neutral-500 uppercase tracking-widest mb-6">
              03 — Investment
            </div>
            <h2 className="text-4xl md:text-5xl font-medium tracking-tight text-white leading-none">
              Transparent Protocols
            </h2>
          </div>

          <div className="flex items-center gap-4 bg-neutral-900/50 p-1.5 rounded-full border border-white/5 backdrop-blur-sm">
            <span
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${!isYearly ? "text-white" : "text-neutral-500"}`}
            >
              Monthly
            </span>
            <button
              onClick={() => setIsYearly(!isYearly)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${
                isYearly ? "bg-emerald-500" : "bg-neutral-700"
              }`}
            >
              <div
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 ${
                  isYearly ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
            <span
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${isYearly ? "text-white" : "text-neutral-500"}`}
            >
              Yearly{" "}
              <span className="text-[9px] text-emerald-400 font-mono tracking-tight">
                -20%
              </span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col p-8 rounded-none border transition-all duration-300 group hover:border-white/10 ${
                plan.popular
                  ? "border-emerald-500/30 bg-emerald-950/[0.03]"
                  : "border-white/5 bg-neutral-900/10"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-emerald-950/80 border border-emerald-500/30 rounded-full text-[10px] font-mono text-emerald-400 uppercase tracking-widest shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)] backdrop-blur-md z-10">
                  Recommended
                </div>
              )}

              {/* Top Section */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-white">
                    {plan.name}
                  </h3>
                  {plan.popular && (
                    <Sparkles className="w-5 h-5 text-emerald-500" />
                  )}
                </div>

                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-5xl font-light tracking-tight text-white">
                    {isYearly && plan.price !== "$0" && plan.price !== "Custom"
                      ? `$${(parseInt(plan.price.slice(1)) * 0.8).toFixed(0)}`
                      : plan.price}
                  </span>
                  <span className="text-sm text-neutral-500 font-mono">
                    {plan.period}
                  </span>
                </div>

                <p className="text-neutral-400 text-sm leading-relaxed border-b border-white/5 pb-8 mb-8 min-h-[80px]">
                  {plan.description}
                </p>

                {/* Features */}
                <ul className="space-y-4 mb-8 flex-grow">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-sm text-neutral-300"
                    >
                      <Check
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${plan.popular ? "text-emerald-500" : "text-neutral-500"}`}
                      />
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA Button */}
              <div className="mt-auto">
                <Link
                  href={plan.href}
                  className={`flex items-center justify-center w-full py-4 text-xs font-mono uppercase tracking-widest transition-all duration-300 border ${
                    plan.popular
                      ? "bg-white text-black border-white hover:bg-neutral-200"
                      : "bg-transparent text-white border-white/10 hover:border-white/30 hover:bg-white/5"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
