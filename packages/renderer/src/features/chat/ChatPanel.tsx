import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

export function ChatPanel() {
  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <MessageList />
      <ChatInput />
    </div>
  );
}
