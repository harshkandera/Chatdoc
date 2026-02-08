import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

// Create an API route that serves the Inngest functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
