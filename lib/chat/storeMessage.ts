import { prisma } from "@/lib/db/prisma";
import { MessageRole } from "@/generated/prisma/client";

export async function storeMessage(params: {
  chatId: string;
  role: MessageRole;
  content: string;
  tokens?: number;
  latencyMs?: number;
}) {
  const { chatId, role, content, tokens, latencyMs } = params;

  return prisma.message.create({
    data: {
      chatId,
      role,
      content,
      tokens,
      latencyMs,
    },
  });
}
