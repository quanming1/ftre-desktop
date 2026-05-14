/**
 * ChatView — Unified chat component for both App and Storybook.
 *
 * mode: "app"       → reads from zustand stores, renders full ChatInput (Slate)
 * mode: "storybook" → reads from props/streamManager directly, renders simple input, shows WS log toggle
 */
import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "@/services/ws-stream-manager";
import { streamManager } from "@/services/ws-stream-manager";
import { wsClient } from "@/services/websocket-client";
import type { ChatSession } from "@/services/ws-stream-manager";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
import { WsLogPanel, type LogEntry } from "./WsLogPanel";

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatViewProps {
  /** "app" = production mode (uses stores), "storybook" = debug mode (uses streamManager directly) */
  mode: "app" | "storybook";
  /** Gateway WebSocket URL (storybook mode only, default: ws://127.0.0.1:18790/) */
  wsUrl?: string;
}

// ─── Component ──────────────────────────────────────────────────────

export function ChatView({ mode, wsUrl = "ws://127.0.0.1:18790/" }: ChatViewProps) {
  if (mode === "app") {
    return <AppMode />;
  }
  return <StorybookMode wsUrl={wsUrl} />;
}

// ─── App Mode ───────────────────────────────────────────────────────

/** Production mode: uses zustand stores, full Slate editor */
function AppMode() {
  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <MessageList />
      <ChatInput />
    </div>
  );
}

// ─── Storybook Mode ─────────────────────────────────────────────────

/** Debug mode: connects to real backend, simple input, WS log panel */
function StorybookMode({ wsUrl }: { wsUrl: string }) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  // Connect and subscribe
  useEffect(() => {
    if (wsUrl) wsClient.setUrl(wsUrl);
    if (!wsClient.connected) wsClient.connect();

    const unsubChange = streamManager.onChange((s) => {
      setSession({ ...s, messages: [...s.messages] });
    });
    const unsubFocus = streamManager.onFocus(() => {
      const active = streamManager.getActiveSession();
      if (active) setSession({ ...active, messages: [...active.messages] });
    });

    // Grab current session if already connected
    const active = streamManager.getActiveSession();
    if (active) setSession({ ...active, messages: [...active.messages] });

    return () => { unsubChange(); unsubFocus(); };
  }, [wsUrl]);

  // Log interceptor
  useEffect(() => {
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
  }, []);

  const send = useCallback(() => {
    if (!input.trim()) return;
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
    setLogEntries((prev) => [...prev, { time, direction: "send", raw: input, parsed: null, role: "user" }]);
    streamManager.sendMessage(input);
    setInput("");
  }, [input]);

  const messages = session?.messages || [];
  const isBusy = session?.isBusy || false;
  const chatId = streamManager.getActiveChatId();
  const connected = wsClient.connected;

  return (
    <div className="h-full flex flex-col relative bg-surface overflow-hidden">
      {/* Toolbar (storybook only) */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10 bg-black/20 text-white">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-[11px] text-t-ghost font-mono flex-1">
          {connected ? chatId || "connecting..." : "disconnected"} | {messages.length} msgs
        </span>
        <button
          onClick={() => setShowLog((v) => !v)}
          className={`px-2 py-0.5 text-[10px] rounded border ${showLog ? "border-neon/50 text-neon bg-neon/10" : "border-white/20 text-t-ghost"}`}
        >
          WS Log ({logEntries.length})
        </button>
      </div>

      {/* Message list */}
      <ChatMessageList messages={messages} isBusy={isBusy} className="flex-1" />

      {/* Simple input */}
      {connected && chatId && (
        <div className="flex gap-2 px-3 py-2 border-t border-white/10 bg-black/20">
          <input
            className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-t-ghost"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type a message..."
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="px-4 py-1.5 text-xs bg-neon/20 text-neon border border-neon/30 rounded hover:bg-neon/30 disabled:opacity-30"
          >
            Send
          </button>
        </div>
      )}

      {/* WS Log overlay */}
      {showLog && (
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
