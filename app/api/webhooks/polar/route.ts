import { Webhooks } from "@polar-sh/nextjs";
import { prisma } from "@/lib/db/prisma";

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPayload: async (payload: any) => {
    const { type, data } = payload;
    console.log(`[Polar Webhook] Handling event: ${type}`);

    try {
      switch (type) {
        case "subscription.created":
        case "subscription.updated":
        case "subscription.active": // Grant Access
          {
            const customerId = data.customer_id;
            const email = data.user?.email || data.customer?.email;

            if (email) {
              await prisma.user.update({
                where: { email },
                data: {
                  subscriptionId: data.id,
                  customerId: customerId,
                  status:
                    type === "subscription.active"
                      ? "active"
                      : data.status || "free",
                  currentPeriodEnd: data.current_period_end
                    ? new Date(data.current_period_end)
                    : undefined,
                  variantId: data.product_price_id,
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
                        : data.status || "free",
                    currentPeriodEnd: data.current_period_end
                      ? new Date(data.current_period_end)
                      : undefined,
                    variantId: data.product_price_id,
                  },
                });
              } catch {
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
      throw error;
    }
  },
});
