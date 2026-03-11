import { prisma } from "@/lib/db/prisma";

export async function ensureUser(user: {
  id: string;
  email: string;
  name?: string | null;
  imageUrl?: string | null;
}) {
  try {
    return await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
      },
      update: {
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
      },
    });
  } catch (err: unknown) {
    // P2002: email unique constraint — another record owns this email (e.g. re-created Clerk user)
    // Update that record's id to match the current Clerk id so lookups work correctly
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return await prisma.user.update({
        where: { email: user.email },
        data: {
          id: user.id,
          name: user.name,
          imageUrl: user.imageUrl,
        },
      });
    }
    throw err;
  }
}
