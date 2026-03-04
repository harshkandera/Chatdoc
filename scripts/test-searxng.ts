/**
 * Test script to understand how SearXNG answers a query.
 * Run: npx tsx scripts/test-searxng.ts
 *
 * Make sure your SearXNG instance has JSON format enabled in settings.yml:
 *   search:
 *     formats:
 *       - html
 *       - json
 */

const SEARXNG_URL = process.env.SEARXNG_URL || process.env.SEARXNG_ENDPOINT || "http://localhost:8080";

const QUERY = process.argv[2] || "Next.js app router tutorial";

async function testSearXNG() {
  console.log(`\n🔍 SearXNG URL: ${SEARXNG_URL}`);
  console.log(`📝 Query: "${QUERY}"\n`);

  const params = new URLSearchParams({
    q: QUERY,
    format: "json",
    categories: "general",
    language: "en",
  });

  const url = `${SEARXNG_URL}/search?${params.toString()}`;
  console.log(`→ Request URL: ${url}\n`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "chatdoc-test/1.0",
      },
    });
  } catch (err) {
    console.error("❌ Failed to connect to SearXNG. Is it running?");
    console.error(err);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`❌ SearXNG returned HTTP ${res.status}`);
    const text = await res.text();
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();

  // --- Summary ---
  console.log("✅ Response received!\n");
  console.log(`Total results: ${data.results?.length ?? 0}`);
  console.log(`Number_of_results: ${data.number_of_results ?? "N/A"}`);
  console.log(`Query time: ${data.query ?? ""}`);
  console.log(`Engines used: ${[...new Set(data.results?.flatMap((r: any) => r.engines ?? []))].join(", ")}\n`);

  // --- Show top 3 results ---
  console.log("── Top 3 Results ──────────────────────────────────────");
  (data.results ?? []).slice(0, 3).forEach((r: any, i: number) => {
    console.log(`\n[${i + 1}] ${r.title}`);
    console.log(`    URL     : ${r.url}`);
    console.log(`    Engine  : ${(r.engines ?? []).join(", ")}`);
    console.log(`    Score   : ${r.score ?? "N/A"}`);
    console.log(`    Snippet : ${(r.content ?? "").slice(0, 200)}`);
  });

  // --- Full raw response (optional) ---
  if (process.argv.includes("--raw")) {
    console.log("\n── Full Raw Response ───────────────────────────────────");
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log("\n💡 Tip: run with --raw to see the full JSON response");
  }
}

testSearXNG();
