import {
  RecursiveCharacterTextSplitter,
  MarkdownTextSplitter,
} from "@langchain/textsplitters";

// Extended chunk interface with full metadata
export interface Chunk {
  content: string;
  index: number;
  metadata: {
    url: string;
    title: string;
    section: string;
    headings: string;
    hasCode: boolean;
    codeLanguages: string[];
    wordCount: number;
  };
}

// Alias for backwards compatibility
export type ChunkWithMetadata = Chunk;

// Create markdown-aware text splitter
const markdownSplitter = new MarkdownTextSplitter({
  chunkSize: 1500, // ~375 tokens (4 chars per token)
  chunkOverlap: 200, // Overlap for context continuity
});

// Extract section from content (first heading found)
function extractSection(content: string): string {
  const headingMatch = content.match(/^#{1,3}\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim() : "General";
}

// Extract all headings as breadcrumb
function extractHeadings(content: string): string {
  const headings: string[] = [];
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[2].trim());
  }

  return headings.slice(0, 3).join(" > ") || "";
}

// Detect if content has code blocks
function detectCode(content: string): {
  hasCode: boolean;
  languages: string[];
} {
  const codeBlockRegex = /```(\w+)?/g;
  const languages: string[] = [];
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match[1]) {
      languages.push(match[1].toLowerCase());
    }
  }

  return {
    hasCode: languages.length > 0 || content.includes("```"),
    languages: [...new Set(languages)], // Unique languages
  };
}

// Count words in content
function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

/**
 * Chunk content with extended metadata extraction
 */
export async function chunkContent(
  content: string,
  url: string,
  title: string,
): Promise<Chunk[]> {
  const docs = await markdownSplitter.createDocuments(
    [content],
    [{ url, title }],
  );

  return docs.map((doc, index) => {
    const chunkContent = doc.pageContent;
    const codeInfo = detectCode(chunkContent);

    return {
      content: chunkContent,
      index,
      metadata: {
        url: doc.metadata.url as string,
        title: doc.metadata.title as string,
        section: extractSection(chunkContent),
        headings: extractHeadings(chunkContent),
        hasCode: codeInfo.hasCode,
        codeLanguages: codeInfo.languages,
        wordCount: countWords(chunkContent),
      },
    };
  });
}

/**
 * Chunk multiple pages with extended metadata
 */
export async function chunkPages(
  pages: { url: string; title: string; content: string }[],
): Promise<Chunk[]> {
  const allChunks: Chunk[] = [];

  for (const page of pages) {
    const chunks = await chunkContent(page.content, page.url, page.title);
    allChunks.push(...chunks);
  }

  // Re-index all chunks globally
  return allChunks.map((chunk, index) => ({
    ...chunk,
    index,
  }));
}

/**
 * Chunk with custom size (for different use cases)
 */
export async function chunkWithSize(
  content: string,
  url: string,
  title: string,
  chunkSize: number = 1500,
  chunkOverlap: number = 200,
): Promise<Chunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const docs = await splitter.createDocuments([content], [{ url, title }]);

  return docs.map((doc, index) => {
    const chunkContent = doc.pageContent;
    const codeInfo = detectCode(chunkContent);

    return {
      content: chunkContent,
      index,
      metadata: {
        url: doc.metadata.url as string,
        title: doc.metadata.title as string,
        section: extractSection(chunkContent),
        headings: extractHeadings(chunkContent),
        hasCode: codeInfo.hasCode,
        codeLanguages: codeInfo.languages,
        wordCount: countWords(chunkContent),
      },
    };
  });
}
