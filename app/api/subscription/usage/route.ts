import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { checkDocLimit, getUserSubscription } from "@/lib/subscription";
import { FREE_PLAN, PRO_PLAN } from "@/lib/plan-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await getUserSubscription(userId);
  const isPro = subscription?.isActive || false;
  const { count, limit, isReached } = await checkDocLimit(userId);

  // Reindex limit info — wrapped in try/catch for resilience
  // (fails gracefully if reindexCount/lastReindexAt columns don't exist yet)
  let reindexData = {
    used: 0,
    limit: isPro ? PRO_PLAN.reindexLimit : FREE_PLAN.reindexLimit,
    remaining: isPro ? PRO_PLAN.reindexLimit : FREE_PLAN.reindexLimit,
    resetsAt: new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      1,
    ).toISOString(),
  };

  try {
    const { checkReindexLimit } = await import("@/lib/reindex-limit");
    const reindexInfo = await checkReindexLimit(userId);
    reindexData = {
      used: reindexInfo.used,
      limit: reindexInfo.limit,
      remaining: reindexInfo.limit - reindexInfo.used,
      resetsAt: reindexInfo.resetsAt.toISOString(),
    };
  } catch (error) {
    console.warn(
      "[Usage API] Reindex limit check failed (columns may not exist yet):",
      error,
    );
  }

  return NextResponse.json({
    isPro,
    plan: subscription?.plan?.name || "Free",
    count,
    limit,
    isReached,
    reindex: reindexData,
    features: isPro ? PRO_PLAN.features : FREE_PLAN.features,
    planConfig: {
      free: {
        price: FREE_PLAN.price,
        workspaceLimit: FREE_PLAN.limit,
        reindexLimit: FREE_PLAN.reindexLimit,
        features: FREE_PLAN.features,
      },
      pro: {
        price: PRO_PLAN.price,
        workspaceLimit: PRO_PLAN.limit,
        reindexLimit: PRO_PLAN.reindexLimit,
        features: PRO_PLAN.features,
      },
    },
  });
}
