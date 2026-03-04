/**
 * Quick smoke-test for the self-hosted Firecrawl instance.
 *
 * Usage:
 *   pnpm tsx scripts/test-firecrawl.ts [url]
 *
 * Default test URL: https://docs.anthropic.com/en/docs/intro-to-claude
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env and .env.local from project root
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

import FirecrawlApp from "@mendable/firecrawl-js";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? "test";
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;
const TEST_URL = process.argv[2] ?? "https://docs.anthropic.com/en/docs/intro-to-claude";

const firecrawl = new FirecrawlApp({
  apiKey: FIRECRAWL_API_KEY,
  apiUrl: FIRECRAWL_API_URL,
});

const host = FIRECRAWL_API_URL ?? "https://api.firecrawl.dev (cloud)";

async function main() {
  console.log("─────────────────────────────────────────────");
  console.log(`🔥 Firecrawl host : ${host}`);
  console.log(`🌐 Test URL       : ${TEST_URL}`);
  console.log("─────────────────────────────────────────────\n");

  // ── 1. Health check ─────────────────────────────────────────────────────
  if (FIRECRAWL_API_URL) {
    process.stdout.write("1. Health check ... ");
    // Try common self-hosted health endpoints
    const healthPaths = ["/health", "/health/liveness", "/v1/health", "/"];
    let healthy = false;
    for (const path of healthPaths) {
      try {
        const res = await fetch(`${FIRECRAWL_API_URL}${path}`);
        if (res.status < 500) {
          console.log(`✅  ${res.status} on ${path} — server is up`);
          healthy = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (!healthy) {
      console.log("❌  Server unreachable — check IP/port/firewall");
      process.exit(1);
    }
  } else {
    console.log("1. Health check ... skipped (cloud mode)");
  }

  // ── 2. Single-page scrape ────────────────────────────────────────────────
  process.stdout.write("2. Scrape single page ... ");
  try {
    const result = await firecrawl.scrape(TEST_URL, { formats: ["markdown"] });

    // Self-hosted Firecrawl may not include a `success` field — check for markdown content
    const md = (result as { markdown?: string }).markdown ?? "";
    const title = (result as { metadata?: { title?: string } }).metadata?.title ?? "(no title)";

    if (!md) {
      console.log(`❌  No markdown returned. Response keys: ${Object.keys(result).join(", ")}`);
      process.exit(1);
    }

    const wordCount = md.split(/\s+/).filter(Boolean).length;
    console.log(`✅  "${title}" — ${wordCount} words`);
    console.log(`    Preview: ${md.slice(0, 120).replace(/\n/g, " ")}…`);
  } catch (e: unknown) {
    console.log(`❌  ${(e as Error).message}`);
    process.exit(1);
  }

  // ── 3. Crawl with includePaths regex (tests our fix) ────────────────────
  process.stdout.write("3. Crawl (limit 3, includePaths regex) ... ");
  try {
    const urlObj = new URL(TEST_URL);
    const basePath = urlObj.pathname.split("/").slice(0, 2).join("/");
    const escapedBasePath = basePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const includePattern = `${escapedBasePath}(/.*)?`;

    console.log(`\n   basePath      : ${basePath}`);
    console.log(`   includePattern: ${includePattern}`);
    process.stdout.write("   starting crawl... ");

    const crawlResult = await firecrawl.crawl(TEST_URL, {
      limit: 3,
      allowExternalLinks: false,
      includePaths: [includePattern],
      scrapeOptions: { formats: ["markdown"] },
    });

    if (crawlResult.status !== "completed") {
      console.log(`⚠️  Status: ${crawlResult.status}`);
    } else {
      const pages = crawlResult.data ?? [];
      console.log(`✅  ${pages.length} page(s) crawled`);
      pages.forEach((p, i) => {
        const url = p.metadata?.url ?? "?";
        const words = (p.markdown ?? "").split(/\s+/).filter(Boolean).length;
        console.log(`   [${i + 1}] ${url} — ${words} words`);
      });
    }
  } catch (e: unknown) {
    console.log(`❌  ${(e as Error).message}`);
    process.exit(1);
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("✅  All checks passed — Firecrawl is working!");
  console.log("─────────────────────────────────────────────");
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
