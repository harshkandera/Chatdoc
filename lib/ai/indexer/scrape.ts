import FirecrawlApp from "@mendable/firecrawl-js";

// ─── Firecrawl client ────────────────────────────────────────────────────────
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY!,
  apiUrl: process.env.FIRECRAWL_API_URL, // optional: self-hosted Firecrawl URL
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

// ─── Public API ───────────────────────────────────────────────────────────────

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
    scrapeOptions: { formats: ["markdown"] },
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
