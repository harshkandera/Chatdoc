import type { Metadata } from "next";
import { ChatSidebar } from "@/components/chat";

export const metadata: Metadata = {
  title: "Chat | ChatDoc - AI-Powered Documentation Chat",
  description:
    "Chat directly with verified technical documentation. Get accurate, sourced answers from your indexed docs.",
};

export default function ChatLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-dvh bg-black overflow-hidden">
      <ChatSidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
