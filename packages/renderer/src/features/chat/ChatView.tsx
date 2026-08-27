/** ChatView — 消息列表、pending 队列横幅与输入框。 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useChat } from "@/stores/chat";
import { hasActiveTurn, hasPendingWork } from "@/stores/runtimeState";
import { useSession } from "@/stores/session";
import { wsClient } from "@/services/websocket-client";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { WelcomeView } from "./WelcomeView";
import { RunContextPanel } from "./RunContextPopover";
import {
  initialRunContextLayoutMode,
  nextRunContextLayoutMode,
  type RunContextLayoutMode,
} from "./runContextLayout";

interface ChatViewProps {
  runContextOpen?: boolean;
}

function useRunContextLayoutMode() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layoutMode, setLayoutMode] = useState<RunContextLayoutMode>(() => (
    typeof window === "undefined"
      ? "rail"
      : initialRunContextLayoutMode(window.innerWidth)
  ));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateLayoutMode = (width = container.getBoundingClientRect().width) => {
      setLayoutMode((currentMode) => nextRunContextLayoutMode(width, currentMode));
    };

    // layout effect 会在首次绘制前采用真实容器宽度，避免打开详情时先闪出右栏再收起。
    updateLayoutMode();
    if (typeof ResizeObserver === "undefined") {
      const handleWindowResize = () => updateLayoutMode();
      window.addEventListener("resize", handleWindowResize);
      return () => window.removeEventListener("resize", handleWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      updateLayoutMode(entries[0]?.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, layoutMode };
}

export function ChatView({ runContextOpen = false }: ChatViewProps) {
  const messages = useChat((state) => Array.isArray(state.messages) ? state.messages : []);
  const sessionStatus = useChat((state) => state.sessionStatus);
  const sessionActivity = useChat((state) => state.sessionActivity);
  const queueDepth = useChat((state) => state.queueDepth);
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
  const hasPending = hasPendingWork(queueDepth, pendingMessages);
  const isWelcome = !sessionId
    && !hasPending
    && sessionStatus === "idle"
    && sessionActivity === "idle"
    && canSend;
  const activeTurn = hasActiveTurn(sessionStatus, sessionActivity);
  const { containerRef, layoutMode } = useRunContextLayoutMode();
  const useRunContextRail = runContextOpen && layoutMode === "rail";

  const gridColumns = useRunContextRail
    ? "grid-cols-[minmax(0,1fr)_minmax(0,848px)_minmax(368px,1fr)]"
    : "grid-cols-[minmax(0,1fr)_minmax(0,848px)_minmax(0,1fr)]";

  return (
    <div
      ref={containerRef}
      className={`relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden motion-reduce:transition-none transition-[grid-template-columns] duration-200 ease-out ${gridColumns}`}
    >
      {isWelcome ? (
        <div className="col-start-2 row-start-1 min-h-0 min-w-0 overflow-hidden">
          <WelcomeView />
        </div>
      ) : isSessionLoading ? (
        <div className="col-start-2 row-start-1 flex min-h-0 items-center justify-center">
          <Loader2 size={22} className="animate-spin text-t-ghost" />
        </div>
      ) : (
        <>
          <ChatMessageList
            messages={messages}
            hasActiveTurn={activeTurn}
            isCompacting={sessionStatus === "compacting"}
            pendingMessagesCount={pendingMessages.length}
            layoutClassName={gridColumns}
            className="col-start-1 col-end-4 row-start-1 min-h-0"
          />
          {canSend ? (
            <div className="z-10 col-start-2 row-start-2 min-w-0">
              <ChatInput />
            </div>
          ) : (
            <div className="z-10 col-start-2 row-start-2 min-w-0">
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

      {runContextOpen && (
        <aside
          data-run-context-layout={layoutMode}
          className="absolute right-4 top-2 z-20 w-[336px] max-w-[calc(100%-2rem)] motion-reduce:transition-none transition-[opacity,transform] duration-150 ease-out"
        >
          <RunContextPanel />
        </aside>
      )}
    </div>
  );
}
