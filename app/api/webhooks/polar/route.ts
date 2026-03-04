import { Webhooks } from "@polar-sh/nextjs";
import { prisma } from "@/lib/db/prisma";
import { invalidateSubscriptionCache } from "@/lib/subscription";

// Guard: if the webhook secret is missing, signature verification is skipped entirely
// by the Polar SDK, allowing anyone to spoof webhook events (#30 fix)
const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;
if (!polarWebhookSecret) {
  throw new Error(
    "[Polar Webhook] POLAR_WEBHOOK_SECRET is not set. Webhook signature verification will not work.",
  );
}

export const POST = Webhooks({
  webhookSecret: polarWebhookSecret,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPayload: async (payload: any) => {
    const { type, data } = payload;
    console.log(`[Polar Webhook] Handling event: ${type}`);

    try {
      switch (type) {
        // --- Order created (fires after successful checkout) ---
        case "order.created": {
          const customerId = data.customer_id || data.customer?.id;
          const externalId = data.customer?.external_id; // Clerk userId
          const email =
            data.customer?.email || data.user?.email || data.customer_email;

          // Try to find user by externalId (Clerk userId) first, then email
          const whereClause = externalId
            ? { id: externalId }
            : email
              ? { email }
              : null;

          if (whereClause && customerId) {
            const updated = await prisma.user.update({
              where: whereClause,
              data: {
                customerId,
                subscriptionId: data.subscription_id || data.subscription?.id,
                status: "active",
                currentPeriodEnd: data.subscription?.current_period_end
                  ? new Date(data.subscription.current_period_end)
                  : undefined,
                variantId: data.product_price_id,
              },
            });
            await invalidateSubscriptionCache(updated.id);
            console.log(
              `[Polar Webhook] order.created → user updated (customerId: ${customerId})`,
            );
          }
          break;
        }

        // --- Checkout completed (backup for order.created) ---
        case "checkout.updated": {
          if (data.status !== "succeeded") break;

          const customerId = data.customer_id || data.customer?.id;
          const externalId = data.customer_external_id || data.metadata?.userId;
          const email = data.customer_email;

          const whereClause = externalId
            ? { id: externalId }
            : email
              ? { email }
              : null;

          if (whereClause && customerId) {
            // Only set customerId — subscription events handle the rest
            await prisma.user.update({
              where: whereClause,
              data: { customerId },
            });
            console.log(
              `[Polar Webhook] checkout.updated → customerId saved (${customerId})`,
            );
          }
          break;
        }

        // --- Subscription lifecycle ---
        case "subscription.created":
        case "subscription.updated":
        case "subscription.active": {
          const customerId = data.customer_id;
          // Polar puts Clerk userId in metadata.userId (set during checkout)
          // or in customer.external_id (if customerExternalId was set)
          const externalId =
            data.metadata?.userId || data.customer?.external_id;
          const email = data.user?.email || data.customer?.email;

          // Try externalId (Clerk userId) → email → customerId
          const whereClause = externalId
            ? { id: externalId }
            : email
              ? { email }
              : customerId
                ? { customerId }
                : null;

          if (whereClause) {
            const polarStatus = data.status as string | undefined;
            const resolvedStatus =
              type === "subscription.active" ||
              polarStatus === "active" ||
              polarStatus === "trialing"
                ? "active"
                : polarStatus || "active";

            console.log(
              `[Polar Webhook] ${type} → polar status="${polarStatus}", resolved="${resolvedStatus}"`,
            );

            const updated = await prisma.user.update({
              where: whereClause,
              data: {
                subscriptionId: data.id,
                customerId: customerId,
                status: resolvedStatus,
                currentPeriodEnd: data.current_period_end
                  ? new Date(data.current_period_end)
                  : undefined,
                variantId: data.price_id || data.product_price_id,
              },
            });
            await invalidateSubscriptionCache(updated.id);
            console.log(
              `[Polar Webhook] ${type} → user updated (customerId: ${customerId})`,
            );
          }
          break;
        }

        case "subscription.revoked":
        case "subscription.canceled": {
          const affected = await prisma.user.findMany({
            where: { subscriptionId: data.id },
            select: { id: true },
          });
          await prisma.user.updateMany({
            where: { subscriptionId: data.id },
            data: {
              status: "canceled",
              currentPeriodEnd: data.current_period_end
                ? new Date(data.current_period_end)
                : undefined,
            },
          });
          await Promise.all(affected.map((u) => invalidateSubscriptionCache(u.id)));
          console.log(
            `[Polar Webhook] ${type} → subscription canceled (periodEnd: ${data.current_period_end || "none"})`,
          );
          break;
        }

        default:
          console.log(`[Polar Webhook] Unhandled event type: ${type}`);
      }
    } catch (error) {
      console.error("[Polar Webhook] Database update failed:", error);
      throw error;
    }
  },
});
