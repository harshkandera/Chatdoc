import { resend, FROM_EMAIL } from "./resend";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

/**
 * Sends an email via Resend.
 * If RESEND_API_KEY is not set, logs a warning and returns — the in-app toast
 * (Option A) handles notification for users who still have the tab open.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!resend) {
    console.warn(
      "[email] RESEND_API_KEY not set — skipping email. In-app toast is the active notification.",
    );
    return;
  }

  const from = opts.from ?? FROM_EMAIL;

  console.log(`[email] Sending → to: ${opts.to} | from: ${from} | subject: "${opts.subject}"`);

  const { data, error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  });

  if (error) {
    console.error(`[email] ❌ Failed → to: ${opts.to} | subject: "${opts.subject}" |`, error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  console.log(`[email] ✅ Sent → id: ${data?.id} | to: ${opts.to} | subject: "${opts.subject}"`);
}
