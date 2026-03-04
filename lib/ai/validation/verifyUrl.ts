import { invokeModel, ModelProvider } from "../models";
import { tavily } from "@tavily/core";
import { normalizeUrl } from "@/lib/db/docSource";
import { prisma } from "@/lib/db/prisma";

type SearchResult = { title: string; url: string; snippet: string };

/**
 * Search via SearXNG (primary) with Tavily fallback.
 * Set SEARXNG_URL for self-hosted SearXNG.
 * Set TAVILY_API_KEY for Tavily fallback.
 * Returns [] if neither is configured.
 */
async function searchWeb(
  query: string,
  maxResults: number = 5,
): Promise<SearchResult[]> {
  // ── Primary: SearXNG ──────────────────────────────────────────────────────
  const searxngUrl = process.env.SEARXNG_URL;
  if (searxngUrl) {
    try {
      const url = new URL("/search", searxngUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("categories", "general");
      url.searchParams.set("language", "en");
      url.searchParams.set("pageno", "1");

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000), // 8s — don't block workspace creation
      });

      if (response.ok) {
        const data = await response.json();
        const results: SearchResult[] = (data.results || [])
          .slice(0, maxResults)
          .map((r: { title: string; url: string; content?: string }) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.slice(0, 200) || "",
          }));
        if (results.length > 0) return results;
        console.warn("[verifyUrl] SearXNG returned 0 results, trying Tavily");
      } else {
        console.warn(
          `[verifyUrl] SearXNG returned ${response.status}, trying Tavily`,
        );
      }
    } catch (err) {
      console.warn(
        `[verifyUrl] SearXNG failed (${(err as Error).message}), trying Tavily`,
      );
    }
  }

  // ── Fallback: Tavily ──────────────────────────────────────────────────────
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const client = tavily({ apiKey: tavilyKey });
      const response = await client.search(query, {
        maxResults,
        includeRawContent: false,
      });
      return response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: (r.content || "").slice(0, 200),
      }));
    } catch (err) {
      console.error("[verifyUrl] Tavily error:", err);
    }
  }

  if (!searxngUrl && !tavilyKey) {
    console.warn("[verifyUrl] Neither SEARXNG_URL nor TAVILY_API_KEY set");
  }
  return [];
}

/**
 * Strip subdomains like "docs.", "developer.", "api." to get the product name
 * for a better search query.
 * e.g. "docs.stripe.com" → "stripe"
 *      "developer.mozilla.org" → "mozilla"
 *      "nextjs.org" → "nextjs"
 */
function extractProductName(domain: string): string {
  const stripped = domain
    .replace(/^(docs|developer|api|developers|reference|help)\./i, "")
    .split(".")[0];
  return stripped;
}

export interface UrlBreakdown {
  fullUrl: string;
  domain: string;
  protocol: string;
  pathSegments: string[];
  possibleRoots: string[];
}

export interface VerificationResult {
  isValid: boolean;
  isOfficialDocs: boolean;
  confidence: "high" | "medium" | "low";

  rootDocsUrl: string;
  userUrlWithinDocs: boolean;

  suggestedName: string;
  product: string;
  docType: "framework" | "library" | "api" | "service" | "language" | "other";

  error?: string;
}

/**
 * Break down a URL into its components
 */

export function breakdownUrl(url: string): UrlBreakdown {
  const parsed = new URL(url);

  const domain = parsed.hostname.replace("www.", "");

  const pathSegments = parsed.pathname.split("/").filter(Boolean);


  const possibleRoots: string[] = [];
  for (let i = pathSegments.length - 1; i >= 0; i--) {
    possibleRoots.push(
      `${parsed.origin}/${pathSegments.slice(0, i + 1).join("/")}`,
    );
  }
  possibleRoots.push(parsed.origin);

  return {
    fullUrl: url,
    domain,
    protocol: parsed.protocol,
    pathSegments,
    possibleRoots,
  };
}

const VALIDATION_PROMPT = `You are a documentation URL validator. Analyze the URL breakdown and search results to determine if this is official documentation.

Return ONLY valid JSON with this structure:
{
  "isOfficialDocs": true/false,
  "confidence": "high" | "medium" | "low",
  "rootDocsUrl": "the root documentation URL (e.g., /docs not /docs/getting-started)",
  "userUrlWithinDocs": true/false,
  "suggestedName": "human readable name for this documentation",
  "product": "product/library/framework name",
  "docType": "framework" | "library" | "api" | "service" | "language" | "other"
}

Rules:
1. Compare user's URL with search results to find official docs
2. rootDocsUrl should be the TOP-LEVEL docs page
3. High confidence: search confirms official + URL matches domain
4. Medium confidence: looks like docs but can't fully confirm
5. Low confidence: suspicious, third-party, or blog content
6. If it's a blog/tutorial site (medium, dev.to, etc.), mark isOfficialDocs as false`;

/**
 * Verify if a URL is official documentation
 */

export async function verifyDocumentationUrl(
  inputUrl: string,
  provider: ModelProvider = (process.env.SMALL_MODEL_PROVIDER || "groq") as ModelProvider,
): Promise<VerificationResult> {

  let breakdown: UrlBreakdown;

  try {

    breakdown = breakdownUrl(inputUrl);

  } catch {
    return {
      isValid: false,
      isOfficialDocs: false,
      confidence: "low",
      rootDocsUrl: "",
      userUrlWithinDocs: false,
      suggestedName: "",
      product: "",
      docType: "other",
      error: "Invalid URL format",
    };
  }

  const searchQuery = `${extractProductName(breakdown.domain)} official documentation`;

  const searchResults = await searchWeb(searchQuery, 5);

  if (searchResults.length === 0) {
    return validateByPatterns(breakdown);
  }

  const response = await invokeModel(provider, [
    {
      role: "system",
      content: VALIDATION_PROMPT,
    },
    {
      role: "user",
      content: `Analyze this documentation URL:

User URL: ${breakdown.fullUrl}
Domain: ${breakdown.domain}
Path segments: ${JSON.stringify(breakdown.pathSegments)}
Possible root URLs: ${JSON.stringify(breakdown.possibleRoots)}

Search Results for "${searchQuery}":
${searchResults.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`).join("\n\n")}`,
    },
  ]);

  // Parse AI response
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) throw new Error("No JSON found");

    const result = JSON.parse(jsonMatch[0]);
    return {
      isValid: true,
      isOfficialDocs: result.isOfficialDocs ?? false,
      confidence: result.confidence ?? "low",
      // possibleRoots[0] = deepest path, possibleRoots[last] = origin (safest fallback)
      rootDocsUrl: result.rootDocsUrl || breakdown.possibleRoots[breakdown.possibleRoots.length - 1],
      userUrlWithinDocs: result.userUrlWithinDocs ?? true,
      suggestedName: result.suggestedName || breakdown.domain,
      product: result.product || "",
      docType: result.docType || "other",
    };
  } catch (error) {
    console.error("Failed to parse validation response:", error);
    return validateByPatterns(breakdown);
  }
}

/**
 * Fallback: validate URL by common patterns when search/AI fails
 */

function validateByPatterns(breakdown: UrlBreakdown): VerificationResult {
  const { domain, pathSegments, possibleRoots, fullUrl } = breakdown;

  // Known official documentation domains
  const knownDocDomains: Record<
    string,
    { name: string; type: VerificationResult["docType"] }
  > = {
    "nextjs.org": { name: "Next.js", type: "framework" },
    "react.dev": { name: "React", type: "library" },
    "vuejs.org": { name: "Vue.js", type: "framework" },
    "angular.io": { name: "Angular", type: "framework" },
    "svelte.dev": { name: "Svelte", type: "framework" },
    "nodejs.org": { name: "Node.js", type: "language" },
    "docs.python.org": { name: "Python", type: "language" },
    "prisma.io": { name: "Prisma", type: "library" },
    "tailwindcss.com": { name: "Tailwind CSS", type: "library" },
    "developer.mozilla.org": { name: "MDN Web Docs", type: "api" },
    "docs.github.com": { name: "GitHub Docs", type: "service" },
    "vercel.com": { name: "Vercel", type: "service" },
  };

  const knownDomain = Object.entries(knownDocDomains).find(([d]) =>
    domain.includes(d),
  );

  if (knownDomain) {
    const [, info] = knownDomain;
    // Find docs root
    const docsSegmentIndex = pathSegments.findIndex((s) =>
      ["docs", "documentation", "guide", "learn", "reference"].includes(
        s.toLowerCase(),
      ),
    );

    const rootDocsUrl =
      docsSegmentIndex >= 0
        ? possibleRoots[pathSegments.length - docsSegmentIndex - 1]
        : fullUrl;

    return {
      isValid: true,
      isOfficialDocs: true,
      confidence: "high",
      rootDocsUrl,
      userUrlWithinDocs: true,
      suggestedName: `${info.name} Documentation`,
      product: info.name,
      docType: info.type,
    };
  }

  // Check for common documentation path patterns
  const hasDocsPath = pathSegments.some((s) =>
    [
      "docs",
      "documentation",
      "guide",
      "learn",
      "reference",
      "api-reference",
    ].includes(s.toLowerCase()),
  );

  // Third-party/blog domains (not official docs)
  const thirdPartyDomains = [
    "medium.com",
    "dev.to",
    "hashnode.dev",
    "freecodecamp.org",
    "stackoverflow.com",
    "github.io",
    "youtube.com",
  ];

  const isThirdParty = thirdPartyDomains.some((d) => domain.includes(d));

  if (isThirdParty) {
    return {
      isValid: true,
      isOfficialDocs: false,
      confidence: "high",
      rootDocsUrl: "",
      userUrlWithinDocs: false,
      suggestedName: "",
      product: "",
      docType: "other",
      error:
        "This appears to be a third-party site, not official documentation",
    };
  }

  // Unknown domain with docs-like path
  if (hasDocsPath) {
    const docsIndex = pathSegments.findIndex((s) =>
      ["docs", "documentation"].includes(s.toLowerCase()),
    );
    const rootDocsUrl =
      docsIndex >= 0
        ? possibleRoots[pathSegments.length - docsIndex - 1]
        : fullUrl;

    return {
      isValid: true,
      isOfficialDocs: true,
      confidence: "medium",
      rootDocsUrl,
      userUrlWithinDocs: true,
      suggestedName: `${domain} Documentation`,
      product: domain.split(".")[0],
      docType: "other",
    };
  }

  // Unknown - low confidence
  return {
    isValid: true,
    isOfficialDocs: false,
    confidence: "low",
    rootDocsUrl: fullUrl,
    userUrlWithinDocs: false,
    suggestedName: domain,
    product: "",
    docType: "other",
    error: "Could not verify if this is official documentation",
  };
}

/**
 * Check whether this doc source already exists for the user.
 * Matches via DocSource.canonicalUrl (normalized) or domain prefix,
 * then checks if the user has a Workspace pointing to that DocSource.
 */
export async function findMatchingWorkspace(
  url: string,
  userId: string,
): Promise<{ workspaceId: string | null; docSourceId: string | null; isExact: boolean }> {
  const canonical = normalizeUrl(url);

  // 1. Exact canonical URL match
  const exactDocSource = await prisma.docSource.findUnique({
    where: { canonicalUrl: canonical },
    select: { id: true },
  });

  if (exactDocSource) {
    const workspace = await prisma.workspace.findUnique({
      where: { userId_docSourceId: { userId, docSourceId: exactDocSource.id } },
      select: { id: true },
    });
    return {
      workspaceId: workspace?.id ?? null,
      docSourceId: exactDocSource.id,
      isExact: true,
    };
  }

  // 2. Domain-prefix match — user gave a deep URL but we already indexed the root
  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { workspaceId: null, docSourceId: null, isExact: false };
  }

  const candidates = await prisma.docSource.findMany({
    where: { canonicalUrl: { startsWith: hostname } },
    select: { id: true, canonicalUrl: true },
  });

  const related = candidates.find(
    (c) => canonical.startsWith(c.canonicalUrl) || c.canonicalUrl.startsWith(canonical),
  );

  if (related) {
    const workspace = await prisma.workspace.findUnique({
      where: { userId_docSourceId: { userId, docSourceId: related.id } },
      select: { id: true },
    });
    return {
      workspaceId: workspace?.id ?? null,
      docSourceId: related.id,
      isExact: false,
    };
  }

  return { workspaceId: null, docSourceId: null, isExact: false };
}

