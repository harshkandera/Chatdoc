import FirecrawlApp from "@mendable/firecrawl-js";

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY!,
});

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  links: string[];
}

// Scrape a single page
export async function scrapePage(url: string): Promise<ScrapedPage> {
  const result = await firecrawl.scrape(url, {
    formats: ["markdown"],
  });


  // Extract internal links from the markdown
  const links = extractDocLinks(result.markdown || "", url);

  return {
    url,
    title:
      result.metadata?.title || extractTitleFromMarkdown(result.markdown || ""),
    content: result.markdown || "",
    links,
  };
}

// Extract documentation links from content
function extractDocLinks(markdown: string, baseUrl: string): string[] {
  const urlObj = new URL(baseUrl);

  const basePath = urlObj.pathname.split("/").slice(0, 2).join("/"); // e.g., /docs

  
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: Set<string> = new Set();

  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    let href = match[2];

    // Skip anchors, external links, and non-doc links
    if (href.startsWith("#") || href.startsWith("mailto:")) continue;

    // Convert relative to absolute
    if (href.startsWith("/")) {
      href = `${urlObj.origin}${href}`;
    } else if (!href.startsWith("http")) {
      href = `${urlObj.origin}${urlObj.pathname}/${href}`;
    }

    // Only keep links from the same documentation
    try {
      const linkUrl = new URL(href);
      if (
        linkUrl.origin === urlObj.origin &&
        linkUrl.pathname.startsWith(basePath)
      ) {
        // Remove hash and query params for deduplication
        links.add(`${linkUrl.origin}${linkUrl.pathname}`);
      }
    } catch {
      // Invalid URL, skip
      console.error(`Invalid URL: ${href}`);
    }
  }

  return Array.from(links);
}

// Extract title from markdown (first # heading)
function extractTitleFromMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}

// Scrape multiple pages with rate limiting
export async function scrapePages(
  urls: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];

  for (let i = 0; i < urls.length; i++) {
    try {
      const page = await scrapePage(urls[i]);
      pages.push(page);
      onProgress?.(i + 1, urls.length);

      // Rate limiting: wait 500ms between requests
      if (i < urls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Failed to scrape ${urls[i]}:`, error);
      // Continue with other pages
    }
  }

  return pages;
}
