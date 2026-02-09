import { Checkout } from "@polar-sh/nextjs";

export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  successUrl:
    process.env.SUCCESS_URL ??
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/success`,
  // returnUrl: "https://myapp.com", // Optional back button
  server: process.env.NODE_ENV === "development" ? "sandbox" : "production",
  theme: "dark",
});
