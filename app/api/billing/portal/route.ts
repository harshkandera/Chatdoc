import { CustomerPortal } from "@polar-sh/nextjs";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export const GET = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  getCustomerId: async (req: NextRequest) => {
    const { userId } = await auth();
    if (!userId) return "";
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true },
    });
    return user?.customerId || "";
  },
  server: process.env.NODE_ENV === "development" ? "sandbox" : "production",
});
