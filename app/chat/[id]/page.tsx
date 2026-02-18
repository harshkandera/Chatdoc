import { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import ClientPage from "./ClientPage";
import { notFound, redirect } from "next/navigation";
import { UIMessage } from "ai";

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: ChatPageProps): Promise<Metadata> {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId) {
    return {
      title: "Chat | ChatDoc",
    };
  }

  const chat = await prisma.chat.findUnique({
    where: {
      id,
      userId,
    },
    select: {
      title: true,
    },
  });

  if (!chat) {
    return {
      title: "Chat Not Found | ChatDoc",
    };
  }

  const title = chat.title || "New Chat";

  return {
    title: `${title} | ChatDoc`,
    openGraph: {
      title: `${title} | ChatDoc`,
      images: [
        {
          url: `/api/og?title=${encodeURIComponent(title)}`,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ChatDoc`,
      images: [`/api/og?title=${encodeURIComponent(title)}`],
    },
  };
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const chat = await prisma.chat.findUnique({
    where: {
      id,
      userId,
    },
    include: {
      Message: {
        orderBy: {
          createdAt: "asc",
        },
      },
      Workspace: {
        select: {
          id: true,
          name: true,
          docSourceId: true,
          DocSource: {
            select: {
              productName: true,
              rootUrl: true,
              status: true,
              chunkCount: true,
            },
          },
        },
      },
    },
  });

  if (!chat) {
    notFound();
  }

  // Convert Prisma messages to AI SDK UIMessage format
  const initialMessages: UIMessage[] = chat.Message.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant",
    parts: [{ type: "text", text: msg.content ?? "" }],
  }));

  return (
    <ClientPage
      initialMessages={initialMessages}
      workspace={chat.Workspace}
    />
  );
}
