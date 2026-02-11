import type { Metadata } from "next";
import { ChatSidebar } from "@/components/chat";
import { MobileWarning } from "@/components/MobileWarning";

export const metadata: Metadata = {
  title: "Chat",
  description:
    "Chat with your indexed documentation. Ask questions and get AI-powered answers with sources.",
  openGraph: {
    title: "Chat | ChatDoc",
    description:
      "Chat with your indexed documentation. AI-powered answers with sources.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ChatLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-dvh bg-black overflow-hidden">
      <MobileWarning />
      <ChatSidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
