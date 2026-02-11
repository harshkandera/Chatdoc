import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const title = searchParams.get("title") || "Chat with your Docs";
  const description =
    searchParams.get("description") ||
    "Get accurate, sourced answers from your documentation instantly — powered by AI.";

  // Load logo from public directory
  const logoPath = join(process.cwd(), "public", "log.png");
  const logoData = await readFile(logoPath);
  const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

  const pills = ["AI-Powered RAG", "Sourced Answers", "Multi-LLM"];

  const cards = [
    {
      title: "Instant documentation answers",
      body: "Ask anything about your codebase, APIs, or product docs. ChatDoc retrieves the most relevant context and responds with precision.",
      tag: "↗ RAG-powered",
      // top-active border: strong at top, fades down
      borderGradient: "linear-gradient(180deg, rgba(16,185,129,0.75) 0%, rgba(16,185,129,0.12) 55%, rgba(6,182,212,0.25) 100%)",
      glowLine: true,
    },
    {
      title: "Transparent source citations",
      body: "Every answer links back to the exact document and section it came from — no hallucinations, full traceability.",
      tag: "↗ Source-grounded",
      // bottom-active border: strong at bottom, fades up
      borderGradient: "linear-gradient(0deg, rgba(6,182,212,0.65) 0%, rgba(16,185,129,0.12) 55%, rgba(16,185,129,0.35) 100%)",
      glowLine: false,
    },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          backgroundColor: "#000000",
          position: "relative",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 72px",
        }}
      >
        {/* ── Grid overlay ── */}
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={`v-${i}`}
              style={{
                position: "absolute",
                left: `${(i * 100) / 15}%`,
                top: 0,
                width: "1px",
                height: "100%",
                backgroundColor: "rgba(255,255,255,0.03)",
                display: "flex",
              }}
            />
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={`h-${i}`}
              style={{
                position: "absolute",
                top: `${(i * 100) / 8}%`,
                left: 0,
                width: "100%",
                height: "1px",
                backgroundColor: "rgba(255,255,255,0.03)",
                display: "flex",
              }}
            />
          ))}
        </div>

        {/* ── Top radial glow ── */}
        <div
          style={{
            position: "absolute",
            top: "-120px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "900px",
            height: "560px",
            borderRadius: "50%",
            background: "radial-gradient(ellipse at center, rgba(16,185,129,0.14), transparent 68%)",
            display: "flex",
          }}
        />

        {/* ── Bottom-right glow ── */}
        <div
          style={{
            position: "absolute",
            bottom: "-100px",
            right: "80px",
            width: "420px",
            height: "320px",
            borderRadius: "50%",
            background: "radial-gradient(ellipse at center, rgba(16,185,129,0.07), transparent 70%)",
            display: "flex",
          }}
        />

        {/* ════════════════════════════════
            LEFT COLUMN
        ════════════════════════════════ */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            zIndex: 2,
            maxWidth: "480px",
          }}
        >
          {/* Logo row */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img
              src={logoBase64}
              alt="ChatDoc"
              width={38}
              height={38}
              style={{ objectFit: "contain", borderRadius: "8px" }}
            />
            <div
              style={{
                display: "flex",
                fontSize: "19px",
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-0.3px",
              }}
            >
              Chat
              <span style={{ color: "#34d399" }}>Doc</span>
            </div>
          </div>

          {/* Headline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: title.length > 20 ? "58px" : "68px",
              fontWeight: 800,
              letterSpacing: "-3px",
              color: "#ffffff",
              lineHeight: 1.05,
            }}
          >
            {/* Render first two words in white, accent on last word */}
            {title}
          </div>

          {/* Description */}
          <div
            style={{
              display: "flex",
              fontSize: "17px",
              color: "#737373",
              fontWeight: 400,
              lineHeight: 1.6,
              maxWidth: "380px",
            }}
          >
            {description}
          </div>

          {/* Pills */}
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            {pills.map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "7px 14px",
                  borderRadius: "999px",
                  border: "1px solid rgba(16,185,129,0.28)",
                  background: "rgba(16,185,129,0.07)",
                  color: "#34d399",
                  fontSize: "12px",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    background: "#10b981",
                  }}
                />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* ════════════════════════════════
            RIGHT COLUMN — dynamic-border cards
        ════════════════════════════════ */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            zIndex: 2,
            width: "430px",
          }}
        >
          {cards.map((card, idx) => (
            /* Wrapper div acts as the "border" layer */
            <div
              key={idx}
              style={{
                display: "flex",
                position: "relative",
                borderRadius: "16px",
                padding: "1px",
                background: card.borderGradient,
              }}
            >
              {/* Inner card */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: "15px",
                  background: "rgba(20,20,20,0.88)",
                  padding: "24px 26px",
                  width: "100%",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Subtle inner top-left tint */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(135deg, rgba(16,185,129,0.04) 0%, transparent 55%)",
                    display: "flex",
                    borderRadius: "15px",
                  }}
                />

                {/* Card title */}
                <div
                  style={{
                    display: "flex",
                    fontSize: "17px",
                    fontWeight: 700,
                    color: "#f5f5f5",
                    marginBottom: "8px",
                    letterSpacing: "-0.3px",
                  }}
                >
                  {card.title}
                </div>

                {/* Card body */}
                <div
                  style={{
                    display: "flex",
                    fontSize: "14px",
                    color: "#737373",
                    lineHeight: 1.6,
                    fontWeight: 400,
                  }}
                >
                  {card.body}
                </div>

                {/* Card tag */}
                <div
                  style={{
                    display: "flex",
                    marginTop: "12px",
                    fontSize: "11px",
                    fontWeight: 500,
                    color: "#10b981",
                    letterSpacing: "0.06em",
                  }}
                >
                  {card.tag}
                </div>

                {/* Glow line (bottom of card 1 only) */}
                {card.glowLine && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: "10%",
                      width: "80%",
                      height: "1px",
                      background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.55), rgba(6,182,212,0.4), transparent)",
                      display: "flex",
                      borderRadius: "1px",
                    }}
                  />
                )}
              </div>
            </div>
          ))}

          {/* Cursor decoration (static, decorative) */}
          <div
            style={{
              position: "absolute",
              right: "200px",
              bottom: "240px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "24px",
            }}
          >
            {/* Arrow cursor SVG substitute: simple triangle */}
            <div
              style={{
                display: "flex",
                width: "0",
                height: "0",
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderBottom: "11px solid rgba(255,255,255,0.85)",
                transform: "rotate(30deg)",
              }}
            />
          </div>
        </div>

        {/* ── Bottom brand bar ── */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "4px",
              height: "16px",
              borderRadius: "2px",
              background: "#10b981",
            }}
          />
          <div
            style={{
              display: "flex",
              color: "#404040",
              fontSize: "13px",
              fontWeight: 500,
              letterSpacing: "0.06em",
            }}
          >
            www.thechatdoc.online
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}