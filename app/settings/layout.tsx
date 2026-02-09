import { ChatSidebar } from "@/components/chat/ChatSidebar";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-black text-white overflow-hidden font-sans">
      <ChatSidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-neutral-900/50">
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </main>
    </div>
  );
}
