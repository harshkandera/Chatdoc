import { invokeModel, ModelProvider } from "../models";
import { SearchResult } from "../pinecone";

export interface GeneratedAnswer {
  content: string;
  sources: string[];
  references: {
    index: number;
    url: string;
    title: string;
  }[];
}

export function buildAnswerContext(chunks: SearchResult[]): {
  context: string;
  uniqueSources: string[];
  references: GeneratedAnswer["references"];
} {
  // Build a URL → reference index map so chunks from the same URL share [N]
  const urlToIndex = new Map<string, number>();
  const references: GeneratedAnswer["references"] = [];
  for (const chunk of chunks) {
    if (!urlToIndex.has(chunk.metadata.url)) {
      const idx = references.length + 1;
      urlToIndex.set(chunk.metadata.url, idx);
      references.push({
        index: idx,
        url: chunk.metadata.url,
        title: chunk.metadata.title || "Reference",
      });
    }
  }

  const context = chunks
    .map((chunk) => {
      const refIdx = urlToIndex.get(chunk.metadata.url) ?? 0;
      const title = chunk.metadata.title || "Untitled";
      const section = chunk.metadata.section
        ? ` - ${chunk.metadata.section}`
        : "";
      return `[${refIdx}] ${title}${section}\nSource: ${chunk.metadata.url}\n${chunk.metadata.content}`;
    })
    .join("\n\n---\n\n");

  const uniqueSources = [...new Set(chunks.map((c) => c.metadata.url))];

  return { context, uniqueSources, references };
}

export function buildCombinedContext(
  queryResults: Map<string, { intent: string; chunks: SearchResult[] }>,
): {
  context: string;
  uniqueSources: string[];
  references: GeneratedAnswer["references"];
} {
  const contextParts: string[] = [];
  const allChunks: SearchResult[] = [];

  for (const [subQuery, { intent, chunks }] of queryResults) {
    if (chunks.length > 0) {
      const subContext = chunks
        .map((chunk, i) => {
          const title = chunk.metadata.title || "Untitled";
          return `  [${allChunks.length + i + 1}] ${title}\n  Source: ${chunk.metadata.url}\n  ${chunk.metadata.content}`;
        })
        .join("\n\n");

      contextParts.push(
        `### ${intent}\nSub-query: "${subQuery}"\n\n${subContext}`,
      );
      allChunks.push(...chunks);
    }
  }

  const context = contextParts.join("\n\n---\n\n");
  const uniqueSources = [...new Set(allChunks.map((c) => c.metadata.url))];
  const references = allChunks
    .filter(
      (chunk, index, self) =>
        index === self.findIndex((c) => c.metadata.url === chunk.metadata.url),
    )
    .map((chunk, i) => ({
      index: i + 1,
      url: chunk.metadata.url,
      title: chunk.metadata.title || "Reference",
    }));

  return { context, uniqueSources, references };
}

export function buildAnswerSystemPrompt(productName: string): string {
  return `You are a helpful documentation assistant for **${productName}**.

Your job is to answer the user's question using the provided documentation context.

## Guidelines

1. **Answer from the context first.** If the documentation chunks contain relevant information, use it. Be accurate — cite specifics from the context.
2. **Use markdown** — code blocks, lists, bold for emphasis, inline code for API names.
3. **Cite sources** — reference documents using [1], [2], etc. when citing specific information.
4. **Integration questions are in scope.** If the user asks about using ${productName} with another technology (React, Node.js, Docker, etc.), help them using the documentation context combined with your general knowledge.
5. **Give partial answers when possible.** If you can answer part of the question from the context, do so and note what's missing. A partial answer is better than no answer.
6. **Only decline if the context is completely irrelevant.** Say "The documentation doesn't cover this topic" ONLY if the provided chunks have absolutely nothing to do with the question. Never guess APIs or configuration that aren't in the context.
7. **Keep answers focused and well-structured.**`;
}

/**
 * Generate an answer from search results using LLM (non-streaming).
 * Used by LangGraph agent and other non-streaming paths.
 */

export async function generateAnswer(
  query: string,
  chunks: SearchResult[],
  productName: string,
  provider: ModelProvider = "groq",
  modelId?: string,
): Promise<GeneratedAnswer> {
  if (chunks.length === 0) {
    return {
      content: "I couldn't find relevant information to answer your question.",
      sources: [],
      references: [],
    };
  }

  const { context, uniqueSources, references } = buildAnswerContext(chunks);

  const resolvedSystemPrompt = buildAnswerSystemPrompt(productName);

  const response = await invokeModel(
    provider,
    [
      { role: "system", content: resolvedSystemPrompt },
      {
        role: "user",
        content: `Context:\n${context}\n\n---\n\nQuestion: ${query}`,
      },
    ],
    modelId,
  );

  return {
    content: response,
    sources: uniqueSources,
    references,
  };
}

/**
 * Generate a combined answer from multiple sub-query results (non-streaming).
 */
export async function generateCombinedAnswer(
  originalQuery: string,
  queryResults: Map<string, { intent: string; chunks: SearchResult[] }>,
  productName: string,
  provider: ModelProvider = "groq",
  modelId?: string,
): Promise<GeneratedAnswer> {
  const { context, uniqueSources, references } =
    buildCombinedContext(queryResults);

  if (uniqueSources.length === 0) {
    return {
      content: "I couldn't find relevant information to answer your question.",
      sources: [],
      references: [],
    };
  }

  const response = await invokeModel(
    provider,
    [
      {
        role: "system",
        content: `You are a helpful documentation assistant for ${productName}. Answer complex questions by synthesizing information from multiple sources.

Guidelines:
- The context is organized by sub-topics that relate to the original question
- Synthesize information across all sections to provide a comprehensive answer
- Use markdown formatting for code blocks, lists, and emphasis
- Include code examples when relevant
- If the user asks a completely unrelated general programming question (e.g., 'write a C++ algorithm'), politely decline and state that you can only answer questions related to the provided documentation.
- However, if the question is about integrating the documented tool with another technology (e.g., 'how to install next js', 'how to use with React'), you MUST use your general knowledge to assist them. Always assume the user means "in the context of this tool" if they name a popular framework.
- Reference source documents using [1], [2], etc. notation
- Structure your answer logically, addressing all aspects of the question`,
      },

      {
        role: "user",
        content: `Context (organized by topic):\n\n${context}\n\n---\n\nOriginal Question: ${originalQuery}`,
      },
    ],
    modelId,
  );

  return {
    content: response,
    sources: uniqueSources,
    references,
  };
}
