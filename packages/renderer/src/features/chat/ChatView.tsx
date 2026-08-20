/** ChatView — 消息列表、pending 队列横幅与输入框。 */
import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { wsClient } from "@/services/websocket-client";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { QueuedMessagesBanner } from "./QueuedMessagesBanner";
import { WelcomeView } from "./WelcomeView";

export function ChatView() {
  const messages = useChat((state) => state.messages);
  const isBusy = useChat((state) => state.isBusy);
  // 所有待执行消息先停留在本地可靠队列；后端写入 UserMsg 并回显后才进入 messages。
  const pendingMessages = useChat((state) => state.pendingMessages);
  const sessionId = useChat((state) => state.sessionId);
  const allSessions = useSession((state) => state.allSessions);
  const loadingSessionId = useSession((state) => state.loadingSessionId);

  useEffect(() => {
    if (!wsClient.connected) wsClient.connect();
  }, []);

  const currentSessionChannel = useMemo(() => {
    if (!sessionId) return "ws";
    const current = allSessions.find(
      (session) => session.session_id === sessionId || session.key?.includes(sessionId),
    );
    return current?.channel || "ws";
  }, [sessionId, allSessions]);
  const canSend = currentSessionChannel === "ws";
  const isSessionLoading = loadingSessionId != null;
  const hasPendingMessages = pendingMessages.length > 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {!sessionId && !isBusy && canSend ? (
        <WelcomeView />
      ) : isSessionLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={22} className="animate-spin text-t-ghost" />
        </div>
      ) : (
        <>
          <ChatMessageList
            messages={messages}
            isBusy={isBusy}
            className={`flex-1 min-h-0 ${hasPendingMessages && canSend ? "pb-[312px]" : "pb-[180px]"}`}
          />
          {canSend ? (
            <div className="absolute bottom-0 left-0 right-0">
              {hasPendingMessages && (
                <div className="px-6">
                  <div className="mx-auto mb-[-34px] w-full max-w-[800px] overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-black/10 bg-[#f6f7f9]/65 pb-8 shadow-[0_4px_14px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-md backdrop-saturate-150">
                    <QueuedMessagesBanner items={pendingMessages} />
                  </div>
                </div>
              )}
              <ChatInput />
            </div>
          ) : (
            <div className="absolute bottom-0 left-0 right-0">
              <div className="px-6 pb-4 pt-3">
                <div className="mx-auto flex w-full max-w-[960px] items-center justify-center gap-1.5 py-2 text-[12px] text-t-ghost">
                  <span className="inline-flex items-center rounded bg-hover px-1.5 py-0.5 font-mono text-[11px] text-t-muted">
                    {currentSessionChannel}
                  </span>
                  <span>渠道的会话仅供查看</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
