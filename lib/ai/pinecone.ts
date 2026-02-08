import { Pinecone } from "@pinecone-database/pinecone";

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

// Get the chatdoc index
export const pineconeIndex = pinecone.index(
  process.env.PINECONE_INDEX || "chatdoc",
);

// Pinecone metadata schema (9 essential fields)
export interface ChunkMetadata {
  docSourceId: string; // Filter by doc source
  content: string; // Chunk text for LLM context
  url: string; // Source URL for citations
  urlHash: string; // For deduplication
  title: string; // Page title for display
  section: string; // Section heading
  chunkIndex: number; // Position in document
  productName: string; // Product name (e.g., "Next.js")
  indexedAt: string; // Timestamp for dedup
  [key: string]: string | number | boolean | string[]; // Index signature for Pinecone
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: ChunkMetadata;
}

// Upsert vectors to Pinecone
export async function upsertVectors(
  vectors: {
    id: string;
    values: number[];
    metadata: ChunkMetadata;
  }[],
) {
  await pineconeIndex.upsert(vectors);
}

// Search vectors by query embedding
export async function searchVectors(
  queryEmbedding: number[],
  docSourceId: string,
  topK: number = 5,
): Promise<SearchResult[]> {


  const results = await pineconeIndex.query({
    vector: queryEmbedding,
    topK,
    filter: { docSourceId },
    includeMetadata: true,
  });

  return (results.matches || []).map((match) => ({
    id: match.id,
    score: match.score || 0,
    metadata: match.metadata as unknown as ChunkMetadata,
  }));


}

// Search with deduplication by URL (keeps latest version)

export async function searchVectorsDeduped(

  queryEmbedding: number[],
  docSourceId: string,
  topK: number = 5,
): Promise<SearchResult[]> {

  // Fetch more results to account for duplicates
  const results = await searchVectors(queryEmbedding, docSourceId, topK * 3);

  // Deduplicate by urlHash, keeping the newest indexedAt
  const latestByUrl = new Map<string, SearchResult>();

  for (const result of results) {

    const urlHash = result.metadata.urlHash;
    const existing = latestByUrl.get(urlHash);

    if (!existing || result.metadata.indexedAt > existing.metadata.indexedAt) {
      latestByUrl.set(urlHash, result);
    }

  }

  // Return top K after dedup, sorted by score
  return Array.from(latestByUrl.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}


// Delete all vectors for a doc source
export async function deleteDocSourceVectors(docSourceId: string) {
  await pineconeIndex.deleteMany({
    filter: { docSourceId },
  });
}

// Legacy: Delete by workspaceId (for migration purposes)
export async function deleteWorkspaceVectors(workspaceId: string) {
  await pineconeIndex.deleteMany({
    filter: { workspaceId },
  });
}
