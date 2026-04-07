import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ChatHeader } from "./ChatHeader";

export function ChatPanel() {
  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <ChatHeader />
      <MessageList />
      <ChatInput />
    </div>
  );
}
