/**
 * Session store — tracks known chat sessions (local state).
 * Syncs with ws-stream-manager for session switching.
 */
import { create } from "zustand";
import { streamManager } from "@/services/ws-stream-manager";
import type { ChatMessage, ToolCall } from "@/services/ws-stream-manager";
import type { SessionSummary } from "@/services/api";
import { fetchSessions, fetchSessionMessages } from "@/services/api";
import { useWorkspace } from "./workspace";
import { useChat } from "./chat";
import { workspaceHash, normalizePathForCompare } from "@/utils/pathUtils";

export type { SessionSummary };

// ─── History Message Conversion ─────────────────────────────────────

let histIdCounter = 0;
function histId(): string {
  return `hist_${Date.now()}_${++histIdCounter}`;
}

/**
 * Convert v5 REST API messages into ChatMessage[] for rendering.
 *
 * v5 storage order per turn: [tool_call, tool_result*, assistant]
 * Render model: one assistant bubble per turn containing tool cards + final text.
 *
 * Algorithm (single pass, simple):
 * - user → push user bubble
 * - tool_call → get/create current turn's assistant bubble, attach tool cards
 * - tool_result → find matching tool card, set result + status
 * - assistant → get/create current turn's assistant bubble, set content + reasoning
 */
function convertHistoryMessages(msgs: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  /** Get or create the assistant message for the current turn (after last user) */
  function currentAssistant(fallbackId: string, fallbackTs: number): ChatMessage {
    // Look backwards for existing assistant in this turn
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "assistant") return result[i];
      if (result[i].role === "user") break;
    }
    // Create new
    const msg: ChatMessage = {
      id: fallbackId,
      role: "assistant",
      content: null,
      timestamp: fallbackTs,
      toolCalls: [],
    };
    result.push(msg);
    return msg;
  }

  for (const m of msgs) {
    const role = m.role as string;
    const data = (m.data || {}) as Record<string, any>;
    const ts = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();

    switch (role) {
      case "user": {
        const content = typeof data.content === "string"
          ? data.content
          : Array.isArray(data.content)
            ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
            : "";
        if (!content) break;
        result.push({ id: m.id || histId(), role: "user", content, timestamp: ts });
        break;
      }

      case "tool_call": {
        const ast = currentAssistant(m.id || histId(), ts);
        if (!ast.toolCalls) ast.toolCalls = [];
        for (const call of (data.calls || [])) {
          ast.toolCalls.push({
            id: call.call_id,
            name: call.name || "unknown",
            arguments: typeof call.arguments === "object"
              ? JSON.stringify(call.arguments)
              : call.arguments || "{}",
            status: "running",
          });
        }
        break;
      }

      case "tool_result": {
        const callId = data.call_id;
        const isError = !!data.error;
        // Find the tool card in any assistant message (search backwards)
        for (let i = result.length - 1; i >= 0; i--) {
          const msg = result[i];
          if (msg.role === "user") break;
          if (msg.toolCalls) {
            const tc = msg.toolCalls.find((t) => t.id === callId);
            if (tc) {
              tc.status = isError ? "error" : "ok";
              tc.result = isError ? data.error : (data.output || "");
              break;
            }
          }
        }
        break;
      }

      case "assistant": {
        const content = data.content ?? "";
        const reasoning = data.reasoning
          || data.thinking_blocks?.find((b: any) => b.thinking)?.thinking
          || undefined;
        // Skip truly empty messages
        if (!content && !reasoning) break;
        // Merge into current turn's assistant (which may already have tool cards)
        const ast = currentAssistant(m.id || histId(), ts);
        ast.content = content;
        if (reasoning) ast.reasoning = reasoning;
        // Update id to the real assistant message id
        ast.id = m.id || ast.id;
        break;
      }

      // Legacy OpenAI format support
      case "tool":
        break; // handled via tool_result

      default:
        break;
    }
  }

  // Clean up: remove assistant messages that have no content AND no tool calls
  return result.filter((m) => {
    if (m.role !== "assistant") return true;
    return m.content || (m.toolCalls && m.toolCalls.length > 0) || m.reasoning;
  });
}
// ─── Storage Keys ───────────────────────────────────────────────────

const SESSION_KEY_PREFIX = "ftre-active-session";
const TABS_KEY_PREFIX = "ftre-open-tabs";

/** 生成按工作区隔离的 localStorage key */
function sessionStorageKey(): string {
  const root = useWorkspace.getState().rootPath;
  return root
    ? `${SESSION_KEY_PREFIX}:${workspaceHash(root)}`
    : SESSION_KEY_PREFIX;
}

function tabsStorageKey(): string {
  const root = useWorkspace.getState().rootPath;
  return root ? `${TABS_KEY_PREFIX}:${workspaceHash(root)}` : TABS_KEY_PREFIX;
}

/** 从 localStorage 恢复 openTabs */
function loadTabsFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(tabsStorageKey());
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

/** 持久化 openTabs 到 localStorage */
function saveTabsToStorage(tabs: string[]): void {
  try {
    localStorage.setItem(tabsStorageKey(), JSON.stringify(tabs));
  } catch {
    /* ignore */
  }
}

interface SessionState {
  sessions: SessionSummary[];
  allSessions: SessionSummary[];
  openTabs: string[];
  loading: boolean;

  loadSessions: (workspace?: string | null) => Promise<void>;
  loadAllSessions: () => Promise<void>;
  loadWorkspaceSessions: (workspace: string) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  openTab: (sessionId: string) => void;
  closeTab: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  newSession: (workspace?: string) => void;
  restoreLatest: (workspace?: string | null) => Promise<void>;
  patchSession: (
    sessionId: string,
    patch: { model?: string | null; agentId?: string },
  ) => void;
}

export const useSession = create<SessionState>((set, get) => ({
  sessions: [],
  allSessions: [],
  openTabs: [],
  loading: false,

  loadSessions: async (_workspace) => {
    set({ loading: true });
    try {
      const sessions = await fetchSessions(_workspace);
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadAllSessions: async () => {
    set({ loading: true });
    try {
      const sessions = await fetchSessions();
      set({ allSessions: sessions, sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadWorkspaceSessions: async (_workspace: string) => {
    set({ loading: true });
    try {
      const sessions = await fetchSessions(_workspace);
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  switchSession: async (sessionId: string) => {
    const { openTabs } = get();
    if (!openTabs.includes(sessionId)) {
      const newTabs = [...openTabs, sessionId];
      set({ openTabs: newTabs });
      saveTabsToStorage(newTabs);
    }

    // Switch immediately — render whatever is in memory (may be empty)
    streamManager.switchChat(sessionId);

    try {
      localStorage.setItem(sessionStorageKey(), sessionId);
    } catch {
      /* ignore */
    }

    // Background: fetch history from server and merge silently
    // Note: fetchSessionMessages uses sessionKeyCache to resolve session_id -> key
    fetchSessionMessages(sessionId)
      .then((msgs) => {
        console.log("[Session] switchSession fetch completed:", {
          sessionId,
          rawMessageCount: msgs?.length ?? 0,
        });
        if (!msgs || msgs.length === 0) {
          console.log("[Session] No messages returned, skipping");
          return;
        }
        const chatMessages = convertHistoryMessages(msgs);
        console.log("[Session] Converted messages:", {
          sessionId,
          convertedCount: chatMessages.length,
        });
        if (chatMessages.length === 0) {
          console.log(
            "[Session] Converted to 0 messages, skipping syncHistory",
          );
          return;
        }
        // syncHistory only emits if data actually changed
        streamManager.syncHistory(sessionId, chatMessages);
      })
      .catch((err) => {
        console.error("[Session] switchSession fetch error:", err);
        // Silent — don't block the UI
      });
  },

  openTab: (sessionId: string) => {
    const { openTabs } = get();
    if (!openTabs.includes(sessionId)) {
      const newTabs = [...openTabs, sessionId];
      set({ openTabs: newTabs });
      saveTabsToStorage(newTabs);
    }
  },

  closeTab: (sessionId: string) => {
    const { openTabs } = get();
    const newTabs = openTabs.filter((id) => id !== sessionId);
    set({ openTabs: newTabs });
    saveTabsToStorage(newTabs);

    // If we closed the active one, switch to adjacent
    const active = streamManager.getActiveSession();
    if (active?.chatId === sessionId) {
      if (newTabs.length > 0) {
        const closedIndex = openTabs.indexOf(sessionId);
        const nextIndex = Math.min(closedIndex, newTabs.length - 1);
        get().switchSession(newTabs[nextIndex]);
      } else {
        streamManager.newChat();
      }
    }
  },

  deleteSession: async (sessionId: string) => {
    get().closeTab(sessionId);
    set({
      sessions: get().sessions.filter((s) => s.session_id !== sessionId),
      allSessions: get().allSessions.filter((s) => s.session_id !== sessionId),
    });
  },

  newSession: (workspace?: string) => {
    const currentWorkspace = useWorkspace.getState().rootPath;
    const isSameWorkspace =
      currentWorkspace &&
      workspace &&
      normalizePathForCompare(workspace) ===
      normalizePathForCompare(currentWorkspace);
    if (workspace && !isSameWorkspace) {
      useWorkspace.getState().setRootPath(workspace);
    }
    streamManager.newChat();
    const chatStore = useChat.getState();
    chatStore.setAgentId("code_agent");
    chatStore.setModel(null);
    try {
      localStorage.removeItem(sessionStorageKey());
    } catch {
      /* ignore */
    }
  },

  patchSession: (sessionId, patch) => {
    const { sessions } = get();
    set({
      sessions: sessions.map((s) => {
        if (s.session_id !== sessionId) return s;
        return {
          ...s,
          agent_id: patch.agentId ?? s.agent_id,
          meta: {
            ...s.meta,
            model: patch.model !== undefined ? patch.model : s.meta?.model,
          },
        };
      }),
    });
  },

  restoreLatest: async (_workspace) => {
    const savedTabs = loadTabsFromStorage();
    set({ openTabs: savedTabs });

    await get().loadSessions();

    let targetSessionId: string | null = null;
    try {
      targetSessionId = localStorage.getItem(sessionStorageKey());
    } catch {
      /* ignore */
    }

    if (targetSessionId) {
      await get().switchSession(targetSessionId);
    } else if (savedTabs.length > 0) {
      await get().switchSession(savedTabs[0]);
    }
  },
}));

// ─── Auto-refresh session list on turn end ─────────────────────────

streamManager.onTurnEnd(() => {
  // Refresh session list after each turn completes
  // This updates titles and other metadata that may have changed
  useSession.getState().loadAllSessions();
});
