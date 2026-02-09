import { prisma } from "@/lib/db/prisma";

export async function ensureUser(user: {
  id: string;
  email: string;
  name?: string | null;
  imageUrl?: string | null;
}) {
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
}
