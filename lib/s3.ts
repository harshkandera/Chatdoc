import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET!;

/**
 * Upload a JSON-serializable object to S3.
 * Returns the S3 key used.
 */
export async function uploadJSON(key: string, data: unknown): Promise<string> {
  const body = JSON.stringify(data);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );

  return key;
}

/**
 * Download and parse a JSON object from S3.
 */
export async function downloadJSON<T>(key: string): Promise<T> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );

  const body = await response.Body?.transformToString();
  if (!body) throw new Error(`Empty S3 object at key: ${key}`);

  return JSON.parse(body) as T;
}

/**
 * Delete a single S3 object by key.
 */
export async function deleteKey(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

/**
 * Delete all S3 objects under a given prefix (e.g., "indexing/{docSourceId}/").
 */
export async function deletePrefix(prefix: string): Promise<void> {
  const listResponse = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
    }),
  );

  const keys = listResponse.Contents?.map((obj) => obj.Key).filter(Boolean) as
    | string[]
    | undefined;

  if (!keys || keys.length === 0) return;

  // Delete individually (simpler than DeleteObjects for small sets)
  await Promise.all(keys.map((key) => deleteKey(key)));
}

/**
 * Check if an S3 key exists without downloading the object.
 * Only returns false for genuine 404s — other errors (throttling, auth) are re-thrown
 * so callers don't silently fall back to a full re-scrape on transient AWS errors.
 */
export async function s3KeyExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "NotFound" || name === "NoSuchKey") return false;
    throw err;
  }
}

/**
 * Generate the S3 key prefix for a given doc source indexing job.
 */
export function indexingPrefix(docSourceId: string): string {
  return `indexing/${docSourceId}/`;
}

/**
 * Generate the S3 key for scraped pages.
 */
export function pagesKey(docSourceId: string): string {
  return `${indexingPrefix(docSourceId)}pages.json`;
}

/**
 * Generate the S3 key for chunks.
 */
export function chunksKey(docSourceId: string): string {
  return `${indexingPrefix(docSourceId)}chunks.json`;
}

/**
 * Generate the S3 prefix for discovered pages (web search fallback).
 * Kept separate from indexing/ to avoid collisions with the main pipeline.
 */
export function discoveredPrefix(docSourceId: string): string {
  return `discovered/${docSourceId}/`;
}

export function discoveredPagesKey(docSourceId: string): string {
  return `${discoveredPrefix(docSourceId)}pages.json`;
}

export function discoveredChunksKey(docSourceId: string): string {
  return `${discoveredPrefix(docSourceId)}chunks.json`;
}

/**
 * S3 key for pages kept alive for the async KG build.
 * Uses a separate "kg/" prefix so the main indexing cleanup (which deletes
 * "indexing/") never touches these. The KG function deletes the key after use.
 */
export function kgPagesKey(docSourceId: string): string {
  return `kg/${docSourceId}/pages.json`;
}
