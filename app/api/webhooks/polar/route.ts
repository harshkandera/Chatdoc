import { Webhooks } from "@polar-sh/nextjs";
import { prisma } from "@/lib/db/prisma";

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => {
    const { type, data } = payload;
    console.log(`[Polar Webhook] Handling event: ${type}`);

    try {
      switch (type) {
        case "subscription.created":
        case "subscription.updated":
        case "subscription.active": // Grant Access
          if (data.user_id || data.customer_id) {
            // Strategy: Try to find user by customer_id if stored, or by email.
            // Note: payload structure might vary slightly, but assuming standard Polar payload.
            // Using 'any' cast for data if types aren't inferred perfectly by helper yet
            const customerId = data.customer_id;
            const email =
              (data as any).user?.email || (data as any).customer?.email;

            if (email) {
              await prisma.user.update({
                where: { email },
                data: {
                  subscriptionId: data.id,
                  customerId: customerId,
                  status:
                    type === "subscription.active"
                      ? "active"
                      : (data as any).status || "free",
                  currentPeriodEnd: (data as any).current_period_end
                    ? new Date((data as any).current_period_end)
                    : undefined,
                  variantId: (data as any).product_price_id,
                },
              });
            } else if (customerId) {
              // Fallback: try to find by customerId if we already have it linked
              try {
                await prisma.user.update({
                  where: { customerId },
                  data: {
                    subscriptionId: data.id,
                    status:
                      type === "subscription.active"
                        ? "active"
                        : (data as any).status || "free",
                    currentPeriodEnd: (data as any).current_period_end
                      ? new Date((data as any).current_period_end)
                      : undefined,
                    variantId: (data as any).product_price_id,
                  },
                });
              } catch (e) {
                // Ignore if not found
              }
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
      // Webhooks helper presumably handles errors by returning 500 or similar
      throw error;
    }
  },
});
