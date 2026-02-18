import { streamText, convertToModelMessages } from "ai";
import { groq } from "@/lib/ai/providers";

export const maxDuration = 30;

// Minimal streaming test — no auth, no DB, no RAG
export async function POST(req: Request) {
  const { messages } = await req.json();

  console.log("[test-stream] Starting stream...");

  // Convert UIMessages (parts format) to CoreMessages (content format)
  const coreMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: groq("llama-3.3-70b-versatile"),
    messages: coreMessages,
    onFinish: ({ text }) => {
      console.log(
        `[test-stream] Done. Length: ${text.length} chars. Preview: "${text.slice(0, 100)}..."`,
      );
    },
  });

  return result.toUIMessageStreamResponse({ sendStart: true });
}
