import { ChatView } from "./ChatView";
import { ChatHeader } from "./ChatHeader";
import { useRunContextPanelState } from "./RunContextPopover";

export function ChatPanel() {
  const { open: runContextOpen, toggleOpen: toggleRunContext } = useRunContextPanelState();

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <ChatHeader runContextOpen={runContextOpen} onToggleRunContext={toggleRunContext} />
      <ChatView runContextOpen={runContextOpen} />
    </div>
  );
}
