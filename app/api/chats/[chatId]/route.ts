import { auth } from "@clerk/nextjs/server";
import { loadChat } from "@/lib/chat/loadChat";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { chatId } = await params;

  const chat = await loadChat({
    chatId,
    userId,
  });

  if (!chat) {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(chat);
}
