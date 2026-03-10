import { headers } from "next/headers";
import { Webhook } from "svix";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/emails/send";
import { ADMIN_EMAIL } from "@/lib/emails/resend";
import { welcomeEmail } from "@/lib/emails/templates/welcome";

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserEventData {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserEventData;
}

export async function POST(req: Request) {
  const payload = await req.text();
  const headerList = await headers();

  const svixHeaders = {
    "svix-id": headerList.get("svix-id")!,
    "svix-timestamp": headerList.get("svix-timestamp")!,
    "svix-signature": headerList.get("svix-signature")!,
  };

  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!webhookSecret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  let event: ClerkWebhookEvent;

  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(payload, svixHeaders) as ClerkWebhookEvent;
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  const { type, data } = event;

  // console.log("🔔 Clerk Webhook received:", type);
  // console.log("📦 Payload:", JSON.stringify(data, null, 2));

  // USER CREATED / UPDATED

  if (type === "user.created" || type === "user.updated") {
    const primaryEmail = data.email_addresses?.find(
      (e) => e.id === data.primary_email_address_id,
    )?.email_address;

    // Skip if no email - email is required in our schema
    if (!primaryEmail) {
      return new Response("User has no primary email", { status: 400 });
    }

    const now = new Date();
    const userName = data.first_name
      ? `${data.first_name} ${data.last_name ?? ""}`.trim()
      : null;

    await prisma.user.upsert({
      where: { id: data.id },
      update: {
        email: primaryEmail,
        name: userName,
        imageUrl: data.image_url,
        updatedAt: now,
      },
      create: {
        id: data.id,
        email: primaryEmail,
        name: userName,
        imageUrl: data.image_url,
        updatedAt: now,
      },
    });

    if (type === "user.created") {
      const firstName = data.first_name || "there";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.thechatdoc.online";

      await sendEmail({
        from: `Harsh from ChatDoc <${ADMIN_EMAIL}>`,
        to: primaryEmail,
        subject: "Welcome to ChatDoc 👋",
        html: welcomeEmail({ firstName, appUrl }),
      }).catch((err) => console.error("[email] Welcome email failed:", err));
    }
  }

  // USER DELETED

  if (type === "user.deleted") {
    await prisma.user.deleteMany({
      where: { id: data.id },
    });
  }

  return new Response("Webhook received", { status: 200 });
}
