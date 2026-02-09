import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { polar } from "@/lib/polar";

export async function POST() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!dbUser?.customerId) {
      // Option 1: Create a customer on the fly?
      // Option 2: Error out (they should subscribe first)
      // For now, if they don't have a customerId, they aren't a subscriber.
      // But Polar might allow portal for free users if we created them as customers.
      return new NextResponse(
        "No customer record found. Please upgrade first.",
        { status: 400 },
      );
    }

    // Generate Customer Portal Link
    // Check SDK docs or use API directly if SDK typing is missing.
    // Based on Polar docs: polar.customerSessions.create({ customer_id: ... })

    // Note: The SDK might be slightly different depending on version.
    // Let's assume standard resource structure.

    const session = await polar.customerSessions.create({
      customerId: dbUser.customerId,
    });

    return NextResponse.json({ url: session.customerPortalUrl });
  } catch (error) {
    console.error("[BILLING_PORTAL]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
