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

/**
 * Generate an answer from search results using LLM
 */
export async function generateAnswer(
  query: string,
  chunks: SearchResult[],
  provider: ModelProvider = "groq",
): Promise<GeneratedAnswer> {
  if (chunks.length === 0) {
    return {
      content: "I couldn't find relevant information to answer your question.",
      sources: [],
      references: [],
    };
  }

  // Build context from chunks
  const context = chunks
    .map((chunk, i) => {
      const title = chunk.metadata.title || "Untitled";
      const section = chunk.metadata.section ? ` - ${chunk.metadata.section}` : "";
      return `[${i + 1}] ${title}${section}\n${chunk.metadata.content}`;
    })
    .join("\n\n---\n\n");

  // Extract unique sources
  const uniqueSources = [...new Set(chunks.map((c) => c.metadata.url))];
  const references = chunks
    .filter((chunk, index, self) => 
      index === self.findIndex((c) => c.metadata.url === chunk.metadata.url)
    )
    .map((chunk, i) => ({
      index: i + 1,
      url: chunk.metadata.url,
      title: chunk.metadata.title || "Reference",
    }));

  const response = await invokeModel(provider, [
    {
      role: "system",
      content: `You are a helpful documentation assistant. Answer questions based ONLY on the provided context.

Guidelines:
- Be accurate and precise - only use information from the context
- Use markdown formatting for code blocks, lists, and emphasis
- Include code examples when relevant
- If the context doesn't contain enough information, say so
- Reference source documents using [1], [2], etc. notation when citing specific information
- Keep answers focused and well-structured`,
    },
    {
      role: "user",
      content: `Context:\n${context}\n\n---\n\nQuestion: ${query}`,
    },
  ]);

  return {
    content: response,
    sources: uniqueSources,
    references,
  };
}

/**
 * Generate a combined answer from multiple sub-query results
 */
export async function generateCombinedAnswer(
  originalQuery: string,
  queryResults: Map<string, { intent: string; chunks: SearchResult[] }>,
  provider: ModelProvider = "groq",
): Promise<GeneratedAnswer> {
  // Build context with sub-query organization
  const contextParts: string[] = [];
  const allChunks: SearchResult[] = [];
  
  for (const [subQuery, { intent, chunks }] of queryResults) {
    if (chunks.length > 0) {
      const subContext = chunks
        .map((chunk, i) => {
          const title = chunk.metadata.title || "Untitled";
          return `  [${allChunks.length + i + 1}] ${title}\n  ${chunk.metadata.content}`;
        })
        .join("\n\n");
      
      contextParts.push(`### ${intent}\nSub-query: "${subQuery}"\n\n${subContext}`);
      allChunks.push(...chunks);
    }
  }

  if (allChunks.length === 0) {
    return {
      content: "I couldn't find relevant information to answer your question.",
      sources: [],
      references: [],
    };
  }

  // Extract unique sources
  const uniqueSources = [...new Set(allChunks.map((c) => c.metadata.url))];
  const references = allChunks
    .filter((chunk, index, self) =>
      index === self.findIndex((c) => c.metadata.url === chunk.metadata.url)
    )
    .map((chunk, i) => ({
      index: i + 1,
      url: chunk.metadata.url,
      title: chunk.metadata.title || "Reference",
    }));

  const response = await invokeModel(provider, [
    {
      role: "system",
      content: `You are a helpful documentation assistant. Answer complex questions by synthesizing information from multiple sources.

Guidelines:
- The context is organized by sub-topics that relate to the original question
- Synthesize information across all sections to provide a comprehensive answer
- Use markdown formatting for code blocks, lists, and emphasis
- Include code examples when relevant
- Reference source documents using [1], [2], etc. notation
- Structure your answer logically, addressing all aspects of the question`,
    },
    {
      role: "user",
      content: `Context (organized by topic):\n\n${contextParts.join("\n\n---\n\n")}\n\n---\n\nOriginal Question: ${originalQuery}`,
    },
  ]);

  return {
    content: response,
    sources: uniqueSources,
    references,
  };
}
