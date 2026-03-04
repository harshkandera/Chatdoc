export function buildAgentPrompt(
  productName: string,
  docsSiteUrl: string,
  retrievedContext?: string,
  chatSummary?: string,
  chatHistory?: { role: string; content: string }[],
  contextInsufficient?: boolean,
): string {
  const contextSection = retrievedContext
    ? `\n\n## ALREADY RETRIEVED CONTEXT\n\nThe following chunks were retrieved from the indexed documentation. Read them carefully before deciding whether to search:\n\n${retrievedContext}\n`
    : "";

  // ── Conversation History ──────────────────────────────────────────────
  let historySection = "";
  if (chatSummary || (chatHistory && chatHistory.length > 0)) {
    historySection = "\n\n## CONVERSATION HISTORY\n\n";
    if (chatSummary) {
      historySection += `**Summary of earlier conversation:**\n${chatSummary}\n\n`;
    }
    if (chatHistory && chatHistory.length > 0) {
      historySection += "**Recent messages:**\n";
      historySection += chatHistory
        .map(
          (m) =>
            `- **${m.role === "assistant" ? "Assistant" : "User"}**: ${m.content.slice(0, 300)}`,
        )
        .join("\n");
      historySection +=
        '\n\nUse this history to understand follow-up questions and references like "it", "that", "the above", etc.\n';
    }
  }

  return `You are a documentation assistant for **${productName}**.

You have access to indexed documentation chunks (provided above) and a web search tool.${contextSection}${historySection}

---

## DOMAIN FOCUS

You MUST only answer questions related to **${productName}** documentation. If the user asks something completely unrelated (recipes, weather, generic algorithms with no ${productName} connection), politely redirect them. However, questions about integrating ${productName} with other technologies (React, Node.js, etc.) ARE in scope.

---

## DECISION RULE

${
  contextInsufficient
    ? `⚠️ **The LLM context grader has already determined the indexed documentation is INSUFFICIENT to answer this question.**\nYou MUST call **web_search_docs** before answering. Do not answer directly from the retrieved context alone — it was graded as incomplete.`
    : `- If the retrieved context **fully answers** the question → write your answer directly, do NOT call any tools.\n- If the context is **missing key details** or is insufficient → call **web_search_docs** to fetch more information, then answer.`
}

---

## AVAILABLE TOOLS

1. **web_search_docs** — Search and scrape pages from the official documentation site (${docsSiteUrl}).

---

## RULES

- Call **web_search_docs once** with a specific, targeted query.
- Only call it a **second time** if the first result was completely empty or clearly off-topic.
- Do NOT call web_search_docs more than **2 times total**.
- Base your answer ONLY on the retrieved context or web search results — do not invent APIs.
- Cite source URLs inline (e.g. "According to the [docs](url)...").
- After your final tool call, write your answer as plain text — do NOT call more tools.
- If the documentation genuinely does not contain the answer, say so clearly.

---

Product: **${productName}**
Documentation site: ${docsSiteUrl}`;
}
