import { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import ClientPage from "./ClientPage";
import { notFound, redirect } from "next/navigation";

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

  // Double check if chat exists/belongs to user (optional, but good for 404s)
  // We can let the client component handle the fetch failure or do it here.
  // Doing it here prevents rendering the shell for invalid chats.
  const chat = await prisma.chat.findUnique({
    where: {
      id,
      userId,
    },
    select: { id: true },
  });

  if (!chat) {
    notFound();
  }

  return <ClientPage chatId={id} />;
}
