import { Webhook } from "svix";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";

const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || "";

export async function POST(req: Request) {
  if (!webhookSecret) {
    return new Response("Error: POLAR_WEBHOOK_SECRET is not set", {
      status: 500,
    });
  }

  const payload = await req.text();
  const headersList = await headers();
  const svix_id = headersList.get("webhook-id") || "";
  const svix_timestamp = headersList.get("webhook-timestamp") || "";
  const svix_signature = headersList.get("webhook-signature") || "";

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error: Missing svix headers", { status: 400 });
  }

  const wh = new Webhook(webhookSecret);
  let event: any;

  try {
    event = wh.verify(payload, {
      "webhook-id": svix_id,
      "webhook-timestamp": svix_timestamp,
      "webhook-signature": svix_signature,
    });
  } catch (err) {
    console.error("Error verification failed:", err);
    return new Response("Error: Verification failed", { status: 400 });
  }

  // Handle the event
  const { type, data } = event;
  console.log(`[Polar Webhook] Handling event: ${type}`);

  try {
    switch (type) {
      case "subscription.created":
      case "subscription.updated":
      case "subscription.active": // Grant Access
      
        if (data.user_id) {
          
          // Linking via user_id metadata if available or email?
          // Polar usually links via email or metadata. Let's assume user.email matches customer.email
          // But data usually has customer_id.
          // We need to match user.
          // Strategy: Try to find user by customer_id if stored, or by email.

          const email = data.user?.email || data.customer?.email; // Depending on payload structure

          if (email) {
            await prisma.user.update({
              where: { email },
              data: {
                subscriptionId: data.id,
                customerId: data.customer_id,
                status:
                  type === "subscription.active"
                    ? "active"
                    : data.status || "free",
                currentPeriodEnd: data.current_period_end
                  ? new Date(data.current_period_end)
                  : undefined,
                variantId: data.product_price_id, // Or similar
              },
            });
          }
        }
        break;

      case "subscription.revoked":
      case "subscription.canceled":
        // Revoke access
        await prisma.user.updateMany({
          where: { subscriptionId: data.id },
          data: {
            status: "canceled",
            currentPeriodEnd: null,
          },
        });
        break;

      default:
        console.log(`[Polar Webhook] Unhandled event type: ${type}`);
    }
  } catch (error) {
    console.error("[Polar Webhook] Database update failed:", error);
    return new Response("Error processing event", { status: 500 });
  }

  return new Response("Event received", { status: 200 });
}
