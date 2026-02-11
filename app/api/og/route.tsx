import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Dynamic params — use defaults if not provided
  const title = searchParams.get("title") || "ChatDoc";
  const description =
    searchParams.get("description") || "AI-Powered Documentation Chat";

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#09090b",
        backgroundImage:
          "radial-gradient(ellipse 80% 50% at 50% 40%, rgba(108, 71, 255, 0.3), transparent)",
      }}
    >
      {/* Subtle grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          opacity: 0.05,
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              borderRight: "1px solid #ffffff",
            }}
          />
        ))}
      </div>

      {/* Content container */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "40px 80px",
        }}
      >
        {/* Logo badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "72px",
            height: "72px",
            borderRadius: "18px",
            background:
              "linear-gradient(135deg, #6c47ff 0%, #4f46e5 50%, #06b6d4 100%)",
            fontSize: "36px",
          }}
        >
          📄
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            fontSize: title.length > 30 ? "48px" : "64px",
            fontWeight: 800,
            letterSpacing: "-2px",
            background:
              "linear-gradient(135deg, #ffffff 0%, #a78bfa 50%, #06b6d4 100%)",
            backgroundClip: "text",
            color: "transparent",
            textAlign: "center",
            lineHeight: 1.1,
            maxWidth: "900px",
          }}
        >
          {title}
        </div>

        {/* Description */}
        <div
          style={{
            display: "flex",
            fontSize: "24px",
            color: "#a3a3a3",
            fontWeight: 400,
            textAlign: "center",
            maxWidth: "700px",
            lineHeight: 1.4,
          }}
        >
          {description}
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "12px",
          }}
        >
          {["RAG Answers", "Sourced", "Multi-LLM"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "8px 20px",
                borderRadius: "999px",
                border: "1px solid rgba(108, 71, 255, 0.4)",
                backgroundColor: "rgba(108, 71, 255, 0.1)",
                color: "#c4b5fd",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom branding */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          color: "#525252",
          fontSize: "16px",
        }}
      >
        www.thechatdoc.online
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}
