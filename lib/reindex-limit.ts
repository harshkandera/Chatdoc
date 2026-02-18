import { getUserSubscription } from "@/lib/subscription";
import { prisma } from "@/lib/db/prisma";
import { FREE_REINDEX_LIMIT, PRO_REINDEX_LIMIT } from "@/lib/plan-config";

export interface ReindexLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  isPro: boolean;
  resetsAt: Date;
}

/**
 * Check if a user has re-index quota remaining this month.
 * Re-index counts reset on the 1st of each month.
 */
export async function checkReindexLimit(
  userId: string,
): Promise<ReindexLimitResult> {
  const subscription = await getUserSubscription(userId);
  const isPro = subscription?.isActive ?? false;
  const limit = isPro ? PRO_REINDEX_LIMIT : FREE_REINDEX_LIMIT;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { reindexCount: true, lastReindexAt: true },
  });

  if (!user) {
    return { allowed: false, used: 0, limit, isPro, resetsAt: getNextReset() };
  }

  // Reset count if last re-index was in a previous month
  const now = new Date();
  const lastReindex = user.lastReindexAt;
  const isNewMonth =
    !lastReindex ||
    lastReindex.getMonth() !== now.getMonth() ||
    lastReindex.getFullYear() !== now.getFullYear();

  const used = isNewMonth ? 0 : user.reindexCount;

  return {
    allowed: used < limit,
    used,
    limit,
    isPro,
    resetsAt: getNextReset(),
  };
}

/**
 * Increment the user's re-index count and update lastReindexAt.
 */
export async function incrementReindexCount(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { reindexCount: true, lastReindexAt: true },
  });

  const now = new Date();
  const lastReindex = user?.lastReindexAt;
  const isNewMonth =
    !lastReindex ||
    lastReindex.getMonth() !== now.getMonth() ||
    lastReindex.getFullYear() !== now.getFullYear();

  await prisma.user.update({
    where: { id: userId },
    data: {
      reindexCount: isNewMonth ? 1 : { increment: 1 },
      lastReindexAt: now,
    },
  });
}

/**
 * Get the date when the re-index limit resets (1st of next month).
 */
function getNextReset(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
