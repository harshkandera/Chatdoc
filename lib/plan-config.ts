/**
 * Centralized plan configuration — all values are env-var-backed for easy changes.
 *
 * NEXT_PUBLIC_ prefix makes these available on both server and client.
 * Server-only limits (reindex) use non-prefixed vars.
 */

// ─── Pricing ────────────────────────────────────────────
export const PRO_PRICE = parseInt(
  process.env.NEXT_PUBLIC_PRO_PRICE || "9",
  10,
);

// ─── Workspace Limits ───────────────────────────────────
export const FREE_WORKSPACE_LIMIT = parseInt(
  process.env.NEXT_PUBLIC_FREE_WORKSPACE_LIMIT || "10",
  10,
);
export const PRO_WORKSPACE_LIMIT = parseInt(
  process.env.NEXT_PUBLIC_PRO_WORKSPACE_LIMIT || "20",
  10,
);

// ─── Re-Index Limits (per month) ────────────────────────
export const FREE_REINDEX_LIMIT = parseInt(
  process.env.FREE_REINDEX_LIMIT || "10",
  10,
);
export const PRO_REINDEX_LIMIT = parseInt(
  process.env.PRO_REINDEX_LIMIT || "20",
  10,
);

// ─── Feature Lists (for UI rendering) ───────────────────
export const FREE_FEATURES = [
  `${FREE_WORKSPACE_LIMIT} Documentation Source`,
  "Basic Chat Interface",
  `${FREE_REINDEX_LIMIT}x Manual Re-Index / month`,
  "Standard RAG Answers",
  "Community Support",
];

export const PRO_FEATURES = [
  `${PRO_WORKSPACE_LIMIT} Documentation Sources`,
  "Advanced Chat + Deep Research",
  `${PRO_REINDEX_LIMIT}x Manual Re-Index / month`,
  "Monthly Auto Re-Index",
  "LangGraph AI Agent",
  "Web Search Fallback",
  "Priority Support",
  "Early Access to Features",
];

// ─── Plan Objects ───────────────────────────────────────
export const FREE_PLAN = {
  name: "Free" as const,
  price: 0,
  limit: FREE_WORKSPACE_LIMIT,
  reindexLimit: FREE_REINDEX_LIMIT,
  features: FREE_FEATURES,
};

export const PRO_PLAN = {
  name: "Pro" as const,
  price: PRO_PRICE,
  limit: PRO_WORKSPACE_LIMIT,
  reindexLimit: PRO_REINDEX_LIMIT,
  features: PRO_FEATURES,
};
