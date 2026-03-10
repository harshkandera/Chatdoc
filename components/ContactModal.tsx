"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSubject?: string;
}

export function ContactModal({ isOpen, onClose, defaultSubject = "" }: ContactModalProps) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: defaultSubject,
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error || "Something went wrong.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
    >
      <div className="relative w-full max-w-lg bg-[#0a0a0a] border border-white/10 p-8">
        {/* Top accent */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 to-emerald-700" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-600 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {status === "success" ? (
          <div className="py-8 text-center">
            <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-500 mb-4">
              Message Sent
            </p>
            <p className="text-white text-lg font-medium mb-2">We&apos;ll be in touch.</p>
            <p className="text-neutral-400 text-sm">
              Expect a reply at <span className="text-white">{form.email}</span> within 24h.
            </p>
            <button
              onClick={onClose}
              className="mt-8 font-mono text-[10px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
              Contact Us
            </p>
            <h2 className="text-xl font-medium text-white mb-8">
              Get in touch
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-[9px] uppercase tracking-widest text-neutral-500 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-black border border-white/10 text-white text-sm px-3 py-2.5 outline-none focus:border-emerald-500/50 transition-colors placeholder-neutral-700"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[9px] uppercase tracking-widest text-neutral-500 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-black border border-white/10 text-white text-sm px-3 py-2.5 outline-none focus:border-emerald-500/50 transition-colors placeholder-neutral-700"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-[9px] uppercase tracking-widest text-neutral-500 mb-2">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="w-full bg-black border border-white/10 text-white text-sm px-3 py-2.5 outline-none focus:border-emerald-500/50 transition-colors placeholder-neutral-700"
                  placeholder="Enterprise plan inquiry"
                />
              </div>

              <div>
                <label className="block font-mono text-[9px] uppercase tracking-widest text-neutral-500 mb-2">
                  Message
                </label>
                <textarea
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full bg-black border border-white/10 text-white text-sm px-3 py-2.5 outline-none focus:border-emerald-500/50 transition-colors placeholder-neutral-700 resize-none"
                  placeholder="Tell us about your use case..."
                />
              </div>

              {status === "error" && (
                <p className="text-red-400 text-xs font-mono">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full py-3 bg-white text-black font-mono text-[10px] uppercase tracking-widest hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "loading" ? "Sending..." : "Send Message"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
