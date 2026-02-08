import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const { userId} = await auth();
  
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const chats = await prisma.chat.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      model: true,
      provider: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return Response.json(chats);
}
