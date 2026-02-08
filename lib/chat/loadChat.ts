import { prisma } from "@/lib/db/prisma";

export async function loadChat(params: { chatId: string; userId: string }) {
  const { chatId, userId } = params;

  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
    include: {
      Message: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!chat) return null;

  // Transform to use lowercase 'messages' for frontend
  return {
    ...chat,
    messages: chat.Message,
  };
}
