import { prisma } from "@/lib/db/prisma";


export const PRO_PLAN = {
  name: "Pro",
  price: 19,
  limit: 10,
};

export const FREE_PLAN = {
  name: "Free",
  price: 0,
  limit: 1,
};


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
