import { prisma } from "@/lib/db/prisma";
import { FREE_PLAN, PRO_PLAN } from "@/lib/plan-config";

// Re-export for convenience
export { FREE_PLAN, PRO_PLAN };

// Lazy Redis import so the module works even if Redis is unconfigured
async function getRedis() {
  try {
    const Redis = (await import("ioredis")).default;
    const host = process.env.REDIS_HOST;
    if (!host) return null;
    return new Redis({
      host,
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true,
      connectTimeout: 1000,
    });
  } catch {
    return null;
  }
}

const SUB_TTL = 300; // 5 minutes

function subKey(userId: string) {
  return `sub:${userId}`;
}

async function fetchUserSubscription(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionId: true,
      status: true,
      currentPeriodEnd: true,
    },
  });

  if (!user) return null;

  const isActive =
    user.status === "active" ||
    (user.status === "canceled" &&
      user.currentPeriodEnd &&
      user.currentPeriodEnd > new Date());

  return {
    isActive,
    plan: isActive ? PRO_PLAN : FREE_PLAN,
    ...user,
  };
}

/**
 * Cached subscription lookup — 5 minute TTL.
 * Redis (shared across all instances) → DB fallback.
 * Instant invalidation via invalidateSubscriptionCache() on Polar webhook.
 */
export async function getUserSubscription(userId: string) {
  const redis = await getRedis();

  if (redis) {
    try {
      const cached = await redis.get(subKey(userId));
      if (cached) return JSON.parse(cached);
    } catch {
      // Redis unavailable — fall through to DB
    }
  }

  const result = await fetchUserSubscription(userId);

  if (redis && result) {
    try {
      await redis.set(subKey(userId), JSON.stringify(result), "EX", SUB_TTL);
    } catch {
      // non-fatal
    }
  }

  return result;
}

/** Call this from the Polar webhook handler after any subscription change. */
export async function invalidateSubscriptionCache(userId: string) {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(subKey(userId));
    } catch {
      // non-fatal
    }
  }
}

export async function checkDocLimit(userId: string) {
  const sub = await getUserSubscription(userId);
  const limit = sub?.plan?.limit ?? FREE_PLAN.limit;

  const count = await prisma.workspace.count({
    where: { userId },
  });

  return {
    count,
    limit,
    isReached: count >= limit,
  };
}
