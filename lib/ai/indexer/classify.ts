import crypto from "crypto";

export interface ClassifyResult {
  changeStrategy: "rss" | "sitemap" | "blind";
  rssUrl?: string;
  sitemapUrl?: string;
  pollIntervalHours: number;
  version?: string;
}

const RSS_PATHS = [
  "/feed.xml",
  "/rss.xml",
  "/atom.xml",
  "/changelog/feed",
  "/feed",
  "/rss",
];

const FETCH_TIMEOUT_MS = 8000;

function withTimeout(promise: Promise<Response>): Promise<Response> {
  return Promise.race([
    promise,
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("fetch timeout")), FETCH_TIMEOUT_MS),
    ),
  ]);
}

async function tryFetch(url: string): Promise<Response | null> {
  try {
    return await withTimeout(fetch(url, { redirect: "follow" }));
  } catch {
    return null;
  }
}

/** Extract version from URL path segments like /v2/ /v14/ /14/ */
function extractVersionFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/(v?\d+(?:\.\d+)?)\//i);
  return match ? match[1] : undefined;
}

/** Parse HTML text for RSS link and meta version */
function parseHtml(html: string, rootUrl: string): { rssUrl?: string; version?: string } {
  const result: { rssUrl?: string; version?: string } = {};

  // RSS/Atom alternate link
  const rssMatch =
    html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/(?:rss|atom)\+xml["']/i);
  if (rssMatch) {
    try {
      result.rssUrl = new URL(rssMatch[1], rootUrl).href;
    } catch {
      result.rssUrl = rssMatch[1];
    }
  }

  // Version meta tags
  const versionMatch =
    html.match(/<meta[^>]+name=["'](?:version|docsearch:version)["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["'](?:version|docsearch:version)["']/i);
  if (versionMatch) result.version = versionMatch[1];

  return result;
}

/** Check if sitemap XML has <lastmod> elements */
function sitemapHasLastmod(xml: string): boolean {
  return xml.includes("<lastmod>");
}

/** Check if RSS/Atom XML has items */
function isValidFeedXml(xml: string): boolean {
  return xml.includes("<item>") || xml.includes("<entry>");
}

export async function classifyDocSource(rootUrl: string): Promise<ClassifyResult> {
  const parsed = new URL(rootUrl);

  const version = extractVersionFromPath(parsed.pathname);
  let rssUrl: string | undefined;
  let sitemapUrl: string | undefined;

  // 1. Fetch root page — look for RSS link in <head>
  const rootRes = await tryFetch(rootUrl);
  if (rootRes?.ok) {
    const html = await rootRes.text();
    const { rssUrl: foundRss, version: foundVersion } = parseHtml(html, rootUrl);
    if (foundRss) rssUrl = foundRss;
    if (foundVersion && !version) {
      // version already extracted from path; only use meta as fallback
    }
    void foundVersion;
  }

  // 2. Try sitemap.xml
  const sitemapCandidate = new URL("/sitemap.xml", parsed.origin).href;
  const sRes = await tryFetch(sitemapCandidate);
  if (sRes?.ok) {
    const xml = await sRes.text();
    if (sitemapHasLastmod(xml)) {
      sitemapUrl = sitemapCandidate;
    }
  }

  // 3. Try common RSS paths if not found via HTML
  if (!rssUrl) {
    for (const rssPath of RSS_PATHS) {
      const candidate = new URL(rssPath, parsed.origin).href;
      const rRes = await tryFetch(candidate);
      if (rRes?.ok) {
        const xml = await rRes.text();
        if (isValidFeedXml(xml)) {
          rssUrl = candidate;
          break;
        }
      }
    }
  }

  // 4. Decide strategy (rss > sitemap > blind)
  if (rssUrl) {
    return { changeStrategy: "rss", rssUrl, sitemapUrl, pollIntervalHours: 24, version };
  }

  if (sitemapUrl) {
    return { changeStrategy: "sitemap", sitemapUrl, pollIntervalHours: 24, version };
  }

  return { changeStrategy: "blind", pollIntervalHours: 72, version };
}

/** Compute SHA-256 hash of a string */
export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
