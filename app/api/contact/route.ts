import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/emails/send";
import { contactNotificationEmail } from "@/lib/emails/templates/contact";
import { CONTACT_EMAIL } from "@/lib/emails/resend";

export async function POST(req: NextRequest) {
  const { name, email, subject, message } = await req.json();

  if (!name || !email || !subject || !message) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  await sendEmail({
    from: `ChatDoc Contact <${CONTACT_EMAIL}>`,
    to: CONTACT_EMAIL,
    subject: `[Contact] ${subject}`,
    html: contactNotificationEmail({ name, email, subject, message }),
    replyTo: email,
  });

  return NextResponse.json({ ok: true });
}
