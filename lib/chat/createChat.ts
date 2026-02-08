import { prisma } from "@/lib/db/prisma";

export async function createChat(params: {
  userId: string;
  title?: string;
  model?: string;
  provider?: string;
  workspaceId?: string;
}) {
  const { userId, title, model, provider, workspaceId } = params;

  return prisma.chat.create({
    data: {
      userId,
      title,
      model,
      provider,
      workspaceId,
    },
  });
}
