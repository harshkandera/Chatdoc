import { polar } from "@/lib/polar";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const priceId = process.env.NEXT_PUBLIC_POLAR_PRICE_ID;

  if (!priceId) {
    console.error("Missing NEXT_PUBLIC_POLAR_PRICE_ID");
    return NextResponse.json({ error: "Configuration error" }, { status: 500 });
  }

  try {
    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/success?checkoutId={CHECKOUT_ID}`;

    // Create checkout session with user details
    const result = await polar.checkouts.create({
      products: [priceId],
      successUrl,
      customerEmail: user.emailAddresses[0]?.emailAddress,
      externalCustomerId: userId, // Links Polar customer → Clerk userId
      metadata: {
        userId: userId,
      },
      // allowDiscountCodes: true,
    });

    return NextResponse.redirect(result.url);
  } catch (error) {
    console.error("Checkout creation failed:", error);
    return NextResponse.json(
      { error: "Failed to initiate checkout" },
      { status: 500 },
    );
  }
}
