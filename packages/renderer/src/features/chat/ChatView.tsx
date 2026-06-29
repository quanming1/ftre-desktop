/**
 * ChatView — Chat message list + input.
 *
 * Single component used in both App and Storybook.
 * Internally handles data source fallback:
 * - Tries zustand store first (useChat)
 * - Falls back to streamManager directly if store is empty/unavailable
 */
import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { wsClient } from "@/services/websocket-client";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { WelcomeView } from "./WelcomeView";
import { WsLogPanel, type LogEntry } from "./WsLogPanel";

function formatRunningDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ─── Component ──────────────────────────────────────────────────────

export function ChatView() {
  const messages = useChat((s) => s.messages);
  const isBusy = useChat((s) => s.isBusy);
  const lastUserInputTs = useChat((s) => s.lastUserInputTs);
  const retryState = useChat((s) => s.retryState);
  const connected = useChat((s) => s.connected);

  // Auto-connect on mount
  useEffect(() => {
    if (!wsClient.connected) wsClient.connect();
  }, []);

  // WS Log state (only active in Storybook / dev mode)
  const isStorybook = typeof window !== "undefined" && window.location.port === "6006";
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  const chatId = useChat((s) => s.sessionId);

  // Determine if current session is a websocket session (can send messages)
  const sessionId = useChat((s) => s.sessionId);
  const allSessions = useSession((s) => s.allSessions);
  const currentSessionChannel = useMemo(() => {
    if (!sessionId) return "ws";
    const found = allSessions.find(
      (s) => s.session_id === sessionId || s.key?.includes(sessionId),
    );
    return found?.channel || "ws";
  }, [sessionId, allSessions]);
  const canSend = currentSessionChannel === "ws";

  // Session loading state
  const loadingSessionId = useSession((s) => s.loadingSessionId);
  const isSessionLoading = loadingSessionId != null;
  const [now, setNow] = useState(() => Date.now());
  const [runningBannerVisible, setRunningBannerVisible] = useState(false);
  const [runningBannerExiting, setRunningBannerExiting] = useState(false);
  const runningDuration = lastUserInputTs
    ? formatRunningDuration(now - lastUserInputTs)
    : null;
  const bannerLabel = retryState
    ? `Retrying ${retryState.attempt}/${retryState.maxAttempts}`
    : lastUserInputTs
      ? "Running"
      : "Preparing";

  useEffect(() => {
    if (!isBusy || !canSend) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isBusy, canSend, lastUserInputTs]);

  useEffect(() => {
    if (isBusy && canSend) {
      setRunningBannerVisible(true);
      setRunningBannerExiting(false);
      return;
    }

    if (!runningBannerVisible) return;

    setRunningBannerExiting(true);
    const timer = window.setTimeout(() => {
      setRunningBannerVisible(false);
      setRunningBannerExiting(false);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [isBusy, canSend, runningBannerVisible]);

  // Log interceptor (only in storybook)
  useEffect(() => {
    if (!isStorybook) return;
    const unsub = wsClient.onMessage((msg) => {
      const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
      setLogEntries((prev) => [...prev, {
        time,
        direction: "recv" as const,
        raw: JSON.stringify(msg),
        parsed: msg,
        role: (msg as any).role,
      }]);
    });
    return unsub;
  }, [isStorybook]);

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Debug toolbar (Storybook only) */}
      {isStorybook && logEntries.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-white/10 bg-black/20">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-[10px] text-t-ghost font-mono flex-1">
            {chatId || "—"} | {messages.length} msgs
          </span>
          <button
            onClick={() => setShowLog((v) => !v)}
            className={`px-2 py-0.5 text-[10px] rounded border ${showLog ? "border-neon/50 text-neon bg-neon/10" : "border-white/20 text-t-ghost"}`}
          >
            WS Log ({logEntries.length})
          </button>
        </div>
      )}

      {/* 主内容：
          - 仅在没有 sessionId（纯新会话还没创建）+ 可发送 → 居中欢迎页
          - 正在切换 session（loadingSessionId 存在） → 居中 loading
          - 已有 sessionId → 消息列表 */}
      {!sessionId && !isBusy && canSend ? (
        <WelcomeView />
      ) : isSessionLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={22} className="text-t-ghost animate-spin" />
        </div>
      ) : (
        <>
          <ChatMessageList
            messages={messages}
            isBusy={isBusy}
            className={`flex-1 min-h-0 ${runningBannerVisible && canSend ? "pb-[225px]" : "pb-[180px]"}`}
          />
          {canSend ? (
            <div className="absolute bottom-0 left-0 right-0">
              {runningBannerVisible && (
                <div className="px-6">
                  <div className="mx-auto mb-[-12px] w-full max-w-[900px]">
                    <div
                      className={`mx-6 overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-border-subtle bg-[#f6f7f9]/95 shadow-[0_4px_14px_rgba(15,23,42,0.05)] backdrop-blur ${
                        runningBannerExiting ? "running-banner-exit" : "running-banner-enter"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 px-4 py-3 text-[13px] font-medium text-t-secondary">
                        <span className={`running-ellipsis shrink-0 ${retryState ? "text-[#b7791f]" : ""}`}>
                          {bannerLabel}
                        </span>
                        {retryState ? (
                          <span
                            className="min-w-0 flex-1 truncate text-right text-[#b7791f]/80"
                            title={retryState.message}
                          >
                            {retryState.message}
                          </span>
                        ) : runningDuration ? (
                          <span className="shrink-0 tabular-nums text-t-muted">{runningDuration}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <ChatInput />
            </div>
          ) : (
            <div className="absolute bottom-0 left-0 right-0">
              <div className="px-6 pb-4 pt-3">
                <div className="mx-auto w-full max-w-[960px] flex items-center justify-center gap-1.5 py-2 text-[12px] text-t-ghost">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-hover font-mono text-[11px] text-t-muted">
                    {currentSessionChannel}
                  </span>
                  <span>渠道的会话仅供查看</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* WS Log overlay (Storybook only) */}
      {isStorybook && showLog && (
        <div className="absolute top-0 right-0 w-[50%] h-full bg-[#0d0d1a] border-l border-white/10 z-50 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
            <span className="text-xs text-t-secondary">WebSocket Log</span>
            <button onClick={() => setShowLog(false)} className="text-xs text-t-ghost hover:text-white">Close</button>
          </div>
          <WsLogPanel entries={logEntries} onClear={() => setLogEntries([])} className="flex-1 min-h-0" />
        </div>
      )}
    </div>
  );
}
