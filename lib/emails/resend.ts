import { Resend } from "resend";

// Resend client — null when key is absent (falls back to Option A: in-app toast)
export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Alias-backed email addresses — set these in your env
export const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "ChatDoc <onboarding@thechatdoc.online>";

export const CONTACT_EMAIL =
  process.env.RESEND_CONTACT_EMAIL || "contact@thechatdoc.online";

export const SALES_EMAIL =
  process.env.RESEND_SALES_EMAIL || "sales@thechatdoc.online";

export const ADMIN_EMAIL =
  process.env.RESEND_ADMIN_EMAIL || "harsh.kandera@thechatdoc.online";
