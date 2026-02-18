"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";

export default function TestStreamPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/test-stream" }),
    [],
  );

  const { messages, status, sendMessage } = useChat({
    transport,
    onError: (err) => console.error("useChat error:", err),
    onFinish: ({ message }) =>
      console.log("✅ onFinish:", JSON.stringify(message).slice(0, 200)),
  });

  const handleSend = () => {
    sendMessage({ text: "Tell me a short joke about programming" });
  };

  return (
    <div style={{ padding: 40, fontFamily: "monospace", maxWidth: 600 }}>
      <h1>🧪 Streaming Test</h1>
      <p>
        Status: <strong>{status}</strong>
      </p>
      <button
        onClick={handleSend}
        disabled={status === "streaming" || status === "submitted"}
        style={{
          padding: "8px 16px",
          fontSize: 14,
          marginBottom: 20,
          cursor: "pointer",
        }}
      >
        Send &quot;Tell me a short joke about programming&quot;
      </button>

      <div style={{ marginTop: 20 }}>
        {messages.map((msg, i) => {
          const textPart = msg.parts?.find((p) => p.type === "text");
          const text =
            textPart && "text" in textPart ? textPart.text || "" : "";
          return (
            <div
              key={i}
              style={{
                padding: 12,
                margin: "8px 0",
                border: "1px solid #333",
                borderRadius: 6,
                background: msg.role === "user" ? "#1a1a2e" : "#16213e",
                color: "#eee",
              }}
            >
              <strong>{msg.role}:</strong> <span>{text}</span>
              {msg.role === "assistant" &&
                status === "streaming" &&
                i === messages.length - 1 && (
                  <span style={{ animation: "blink 1s infinite" }}>▌</span>
                )}
            </div>
          );
        })}
      </div>

      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}
