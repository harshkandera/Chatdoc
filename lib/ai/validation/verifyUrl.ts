import { invokeModel, ModelProvider } from "../models";


async function searchWeb(
  query: string,
  maxResults: number = 5,
): Promise<{ title: string; url: string; snippet: string }[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn("TAVILY_API_KEY not set, skipping web search");
    return [];
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });

    if (!response.ok) {
      console.error("Tavily search failed:", await response.text());
      return [];
    }

    const data = await response.json();

    return (data.results || []).map(
      (r: { title: string; url: string; content: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 200) || "",
      }),
    );
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
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
  provider: ModelProvider = "groq",
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

  const searchQuery = `${breakdown.domain} official documentation`;

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
      rootDocsUrl: result.rootDocsUrl || breakdown.possibleRoots[0],
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
 * Find or suggest existing workspace for a URL
 */


export async function findMatchingWorkspace(
  url: string,
  userId: string,
  prisma: { workspace: { findFirst: (args: { where: object }) => Promise<{ id: string } | null> } },
): Promise<{ workspaceId: string | null; isExact: boolean }> {
  const breakdown = breakdownUrl(url);

  // Check each possible root URL
  for (const possibleRoot of breakdown.possibleRoots) {
    const workspace = await prisma.workspace.findFirst({
      where: {
        userId,
        sourceUrl: possibleRoot,
      },
    });

    if (workspace) {
      return { workspaceId: workspace.id, isExact: true };
    }
  }

  // Check for partial domain match
  const domainMatch = await prisma.workspace.findFirst({
    where: {
      userId,
      sourceUrl: { contains: breakdown.domain },
    },
  });

  if (domainMatch) {
    return { workspaceId: domainMatch.id, isExact: false };
  }

  return { workspaceId: null, isExact: false };
}
