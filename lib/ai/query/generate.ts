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
  const context = chunks
    .map((chunk, i) => {
      const title = chunk.metadata.title || "Untitled";
      const section = chunk.metadata.section
        ? ` - ${chunk.metadata.section}`
        : "";
      return `[${i + 1}] ${title}${section}\nSource: ${chunk.metadata.url}\n${chunk.metadata.content}`;
    })
    .join("\n\n---\n\n");

  const uniqueSources = [...new Set(chunks.map((c) => c.metadata.url))];
  const references = chunks
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

const ANSWER_SYSTEM_PROMPT = `You are a helpful documentation assistant. Answer questions based ONLY on the provided context.

Guidelines:
- Be accurate and precise - only use information from the context
- Use markdown formatting for code blocks, lists, and emphasis
- Include code examples when relevant
- If the context does not contain enough information to answer the question accurately, you MUST say: "I don't have enough information in the documentation to answer this question." Do NOT guess or infer.
- If the user asks a completely unrelated general programming question (e.g., 'write a C++ algorithm' or 'explain CSS flexbox'), politely decline and state that you can only answer questions related to the provided documentation.
- However, if the question is about integrating the documented tool with another technology (e.g., 'how to install next js', 'how to use with React'), you MUST use your general knowledge to assist them. Always assume the user means "in the context of this tool" if they name a popular framework.
- Reference source documents using [1], [2], etc. notation when citing specific information
- Keep answers focused and well-structured`;

export const ANSWER_SYSTEM_PROMPT_TEXT = ANSWER_SYSTEM_PROMPT;

/**
 * Generate an answer from search results using LLM (non-streaming).
 * Used by LangGraph agent and other non-streaming paths.
 */
export async function generateAnswer(
  query: string,
  chunks: SearchResult[],
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

  const response = await invokeModel(
    provider,
    [
      { role: "system", content: ANSWER_SYSTEM_PROMPT },
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
        content: `You are a helpful documentation assistant. Answer complex questions by synthesizing information from multiple sources.

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
