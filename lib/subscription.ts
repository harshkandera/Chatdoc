import { prisma } from "@/lib/db/prisma";
import { FREE_PLAN, PRO_PLAN } from "@/lib/plan-config";

// Re-export for convenience
export { FREE_PLAN, PRO_PLAN };

export async function getUserSubscription(userId: string) {
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

export async function checkDocLimit(userId: string) {
  const sub = await getUserSubscription(userId);
  const limit = sub?.plan?.limit || 1;

  const count = await prisma.workspace.count({
    where: { userId },
  });

  return {
    count,
    limit,
    isReached: count >= limit,
  };
}
