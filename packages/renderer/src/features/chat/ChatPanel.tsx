import { ChatView } from "./ChatView";
import { ChatHeader } from "./ChatHeader";

export function ChatPanel() {
  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <ChatHeader />
      <ChatView mode="app" />
    </div>
  );
}
