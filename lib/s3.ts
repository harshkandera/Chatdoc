import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
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
