import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { checkDocLimit, getUserSubscription } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await getUserSubscription(userId);
  const { count, limit, isReached } = await checkDocLimit(userId);

  return NextResponse.json({
    isPro: subscription?.isActive || false,
    plan: subscription?.plan?.name || "Free",
    count,
    limit,
    isReached,
  });
}
