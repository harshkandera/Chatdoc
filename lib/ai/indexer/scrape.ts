import FirecrawlApp, { FirecrawlAppV1 as FirecrawlV1Client } from "@mendable/firecrawl-js";

// ─── Firecrawl clients ────────────────────────────────────────────────────────
// v2 default client — used for single-page scrape
export const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY!,
  apiUrl: process.env.FIRECRAWL_API_URL,
});

// v1 client — used for async crawl (hits /v1/crawl, works on self-hosted)
const firecrawlV1 = new FirecrawlV1Client({
  apiKey: process.env.FIRECRAWL_API_KEY!,
  apiUrl: process.env.FIRECRAWL_API_URL,
});

// ─── Shared types ─────────────────────────────────────────────────────────────
export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  links: string[];
}

// ─── Post-processor: minimize tokens ─────────────────────────────────────────
function cleanMarkdown(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, "") // remove images
    .replace(/\[.*?\]\(#.*?\)/g, "") // remove anchor-only links
    .replace(/\n{3,}/g, "\n\n") // collapse blank lines
    .trim();
}

// ─── SSRF Protection ──────────────────────────────────────────────────────────
// Blocks file://, http://, internal IPs, AWS metadata endpoint, etc.
async function validateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SSRF: invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`SSRF: blocked non-HTTP protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`SSRF: blocked internal hostname: ${hostname}`);
  }

  try {
    const { promises: dns } = await import("dns");
    const { address } = await dns.lookup(hostname);
    const parts = address.split(".").map(Number);

    const isPrivate =
      parts[0] === 127 ||
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      address === "::1";

    if (isPrivate) {
      throw new Error(`SSRF: blocked private/internal IP: ${address}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("SSRF:")) throw err;
    console.warn(
      `[validateUrl] DNS lookup failed for ${hostname}, allowing:`,
      err,
    );
  }
}

// ─── Async Crawl API (Inngest-safe, uses /v1/crawl for self-hosted compat) ────

function buildV1CrawlOptions(rootUrl: string) {
  const rootUrlObj = new URL(rootUrl);
  const basePath = rootUrlObj.pathname.split("/").slice(0, 2).join("/");
  const hasBasePath = basePath && basePath !== "/";
  const escapedBasePath = hasBasePath
    ? basePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    : null;
  return {
    limit: 500,
    allowExternalLinks: false,
    ...(escapedBasePath ? { includePaths: [`${escapedBasePath}(/.*)?`] } : {}),
    scrapeOptions: { formats: ["markdown" as const, "links" as const] },
  };
}

/**
 * Start a Firecrawl crawl asynchronously via /v1/crawl (self-hosted compatible).
 * Returns immediately with a job ID.
 */
export async function startDocsCrawl(rootUrl: string): Promise<string> {
  await validateUrl(rootUrl);
  const response = await firecrawlV1.asyncCrawlUrl(rootUrl, buildV1CrawlOptions(rootUrl));
  if (!response.success) throw new Error("Firecrawl failed to start crawl");
  return (response as { success: true; id: string }).id;
}

/**
 * Check crawl status. Returns { done, completed, total } so callers can show progress.
 * Throws on failure/cancellation.
 */
export async function checkCrawlComplete(crawlId: string): Promise<{ done: boolean; completed: number; total: number }> {
  const res = await firecrawlV1.checkCrawlStatus(crawlId);
  if (!res.success) throw new Error(`Firecrawl status check failed for ${crawlId}`);
  const status = res as { success: true; status: string; completed: number; total: number };
  console.log(`[checkCrawlComplete] crawlId=${crawlId} status=${status.status} completed=${status.completed}/${status.total}`);
  if (status.status === "failed" || status.status === "cancelled") {
    throw new Error(`Firecrawl crawl ${crawlId} ended with status: ${status.status}`);
  }
  return { done: status.status === "completed", completed: status.completed ?? 0, total: status.total ?? 0 };
}

/**
 * Fetch all scraped pages for a completed crawl via /v1/crawl/:id.
 * getAllData=true fetches all paginated results automatically.
 */
export async function fetchCrawlPages(crawlId: string): Promise<ScrapedPage[]> {
  const res = await firecrawlV1.checkCrawlStatus(crawlId, true); // true = getAllData
  if (!res.success) throw new Error(`Firecrawl fetch failed for ${crawlId}`);
  const result = res as { success: true; total: number; data: { markdown?: string; metadata?: { sourceURL?: string; url?: string; title?: string } }[] };
  console.log(`[fetchCrawlPages] crawlId=${crawlId} total=${result.total} fetched=${result.data?.length ?? 0}`);
  return (result.data ?? []).map((doc) => ({
    url: doc.metadata?.sourceURL ?? doc.metadata?.url ?? "",
    title: doc.metadata?.title || extractTitleFromMarkdown(doc.markdown ?? ""),
    content: cleanMarkdown(doc.markdown ?? ""),
    links: [],
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SPA-aware BFS scraper using /v1/scrape (Playwright) instead of /v1/crawl BFS.
 * Firecrawl's crawl uses fast-fetch for link discovery (no JS), so SPAs return 2 pages.
 * This does a proper BFS using the scrape endpoint which always uses Playwright.
 *
 * Use as fallback when startDocsCrawl + fetchCrawlPages returns < 5 pages.
 */
export async function scrapeDocsSPA(
  rootUrl: string,
  maxPages = 200,
  onProgress?: (scraped: number, total: number) => void,
): Promise<ScrapedPage[]> {
  await validateUrl(rootUrl);

  const rootUrlObj = new URL(rootUrl);
  const basePath = rootUrlObj.pathname.split("/").slice(0, 2).join("/");
  const hasBasePath = basePath && basePath !== "/";

  const visited = new Set<string>();
  const queue: string[] = [rootUrl];
  const pages: ScrapedPage[] = [];

  const normalize = (u: string) => {
    try {
      const parsed = new URL(u);
      return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
    } catch {
      return u;
    }
  };

  visited.add(normalize(rootUrl));

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;

    try {
      const result = await firecrawl.scrape(url, {
        formats: ["markdown", "links"],
      });

      const page: ScrapedPage = {
        url,
        title: result.metadata?.title || extractTitleFromMarkdown(result.markdown ?? ""),
        content: cleanMarkdown(result.markdown ?? ""),
        links: [],
      };
      pages.push(page);
      onProgress?.(pages.length, pages.length + queue.length);

      // Discover new links from Playwright-rendered page
      const rawLinks: string[] = (result as { links?: string[] }).links ?? [];
      for (const href of rawLinks) {
        try {
          const u = new URL(href, url);
          if (u.origin !== rootUrlObj.origin) continue;
          if (hasBasePath && !u.pathname.startsWith(basePath)) continue;
          const norm = normalize(u.href);
          if (!visited.has(norm)) {
            visited.add(norm);
            queue.push(norm);
          }
        } catch {
          // skip invalid URLs
        }
      }

      console.log(`[scrapeDocsSPA] scraped=${pages.length} queue=${queue.length} url=${url}`);

      if (queue.length > 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      console.error(`[scrapeDocsSPA] failed: ${url}`, err);
    }
  }

  return pages;
}

// Scrape a single page via Firecrawl
export async function scrapePage(url: string): Promise<ScrapedPage> {
  await validateUrl(url);

  const result = await firecrawl.scrape(url, { formats: ["markdown"] });

  const title =
    result.metadata?.title || extractTitleFromMarkdown(result.markdown ?? "");
  const content = cleanMarkdown(result.markdown ?? "");
  const links = extractDocLinks(result.markdown ?? "", url);

  return { url, title, content, links };
}

// Scrape a fixed list of URLs sequentially
export async function scrapePages(
  urls: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];

  for (let i = 0; i < urls.length; i++) {
    try {
      const page = await scrapePage(urls[i]);
      pages.push(page);
      await onProgress?.(i + 1, urls.length);

      if (i < urls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Failed to scrape ${urls[i]}:`, error);
    }
  }

  return pages;
}

// ─── Recursive Crawler via Firecrawl ──────────────────────────────────────────
// Uses Firecrawl's native crawl API — handles deduplication, same-domain
// enforcement, and respects the page limit to prevent infinite loops.

export interface CrawlOptions {
  maxPages?: number; // default 500
  onProgress?: (scraped: number, queued: number) => void;
}

export async function crawlDocs(
  rootUrl: string,
  opts: CrawlOptions = {},
): Promise<ScrapedPage[]> {
  const { maxPages = 500, onProgress } = opts;

  await validateUrl(rootUrl);

  const rootUrlObj = new URL(rootUrl);
  // Derive the base path segment (e.g. "/docs" from "/docs/getting-started")
  // so we stay within the same documentation section and never go backwards.
  const basePath = rootUrlObj.pathname.split("/").slice(0, 2).join("/");
  const hasBasePath = basePath && basePath !== "/";

  // Firecrawl includePaths uses regex patterns, not globs.
  // Escape special regex chars in the path, then allow anything after it.
  const escapedBasePath = hasBasePath
    ? basePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    : null;

  const result = await firecrawl.crawl(rootUrl, {
    limit: maxPages,
    // Never follow links to external domains
    allowExternalLinks: false,
    // Restrict to the same base path segment when one exists
    ...(escapedBasePath
      ? { includePaths: [`${escapedBasePath}(/.*)?`] }
      : {}),
    scrapeOptions: { formats: ["markdown", "links"] },
  });

  if (result.status !== "completed") {
    throw new Error(
      `[crawlDocs] Firecrawl crawl did not complete for ${rootUrl} (status: ${result.status})`,
    );
  }

  const pages: ScrapedPage[] = result.data.map((doc) => ({
    url: doc.metadata?.url ?? rootUrl,
    title:
      doc.metadata?.title || extractTitleFromMarkdown(doc.markdown ?? ""),
    content: cleanMarkdown(doc.markdown ?? ""),
    links: doc.links ?? [],
  }));

  onProgress?.(pages.length, 0);

  return pages;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract same-domain doc links from Markdown text (used for single-page scrape)
function extractDocLinks(markdown: string, baseUrl: string): string[] {
  const urlObj = new URL(baseUrl);
  const basePath = urlObj.pathname.split("/").slice(0, 2).join("/");
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = new Set<string>();
  let match;

  while ((match = linkRegex.exec(markdown)) !== null) {
    let href = match[2];
    if (href.startsWith("#") || href.startsWith("mailto:")) continue;

    if (href.startsWith("/")) {
      href = `${urlObj.origin}${href}`;
    } else if (!href.startsWith("http")) {
      href = `${urlObj.origin}${urlObj.pathname}/${href}`;
    }

    try {
      const linkUrl = new URL(href);
      // Only same origin + same base path
      if (
        linkUrl.origin === urlObj.origin &&
        linkUrl.pathname.startsWith(basePath)
      ) {
        links.add(`${linkUrl.origin}${linkUrl.pathname}`);
      }
    } catch {
      // skip invalid URLs
    }
  }

  return Array.from(links);
}

// Extract title from Markdown first H1 (fallback when metadata is missing)
function extractTitleFromMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}
