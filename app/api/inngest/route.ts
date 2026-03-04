import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

// Vercel max duration — each individual Inngest step invocation must fit within this.
// Scraping is now async (Firecrawl handles it), so steps are short-lived.
export const maxDuration = 300;

// Create an API route that serves the Inngest functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
