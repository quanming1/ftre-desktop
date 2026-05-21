/**
 * Session store — tracks known chat sessions (local state).
 */
import { create } from "zustand";
import type { ChatMessage } from "./chat";
import { useChat } from "./chat";
import type { SessionSummary } from "@/services/api";
import { fetchSessions, fetchSessionMessages } from "@/services/api";
import { useWorkspace } from "./workspace";
import { workspaceHash, normalizePathForCompare } from "@/utils/pathUtils";

export type { SessionSummary };

// ─── History Message Conversion ─────────────────────────────────────

let histIdCounter = 0;
function histId(): string {
  return `hist_${Date.now()}_${++histIdCounter}`;
}

/**
 * 将后端事件流格式转换为 ChatMessage[] 用于渲染。
 *
 * 后端格式: {id, session_id, type, data, timestamp}
 * type: USER_INPUT / tool_call / tool_result / message_complete / done / error
 *
 * 转换规则：
 * - USER_INPUT       → user bubble
 * - tool_call        → 当前 turn 的 assistant bubble 里加 tool card
 * - tool_result      → 找到对应 tool card，设置 result + status
 * - message_complete → 当前 turn 的 assistant bubble 设置 content
 * - done / error     → 跳过
 */
function convertHistoryMessages(msgs: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  /** 获取或创建当前 turn 的 assistant 消息 */
  function currentAssistant(fallbackId: string, fallbackTs: number): ChatMessage {
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "assistant") return result[i];
      if (result[i].role === "user") break;
    }
    const msg: ChatMessage = {
      id: fallbackId,
      role: "assistant",
      content: null,
      timestamp: fallbackTs,
      toolCalls: [],
      parts: [],
    };
    result.push(msg);
    return msg;
  }

  for (const m of msgs) {
    const type = m.type as string;
    const data = (m.data || {}) as Record<string, any>;
    const ts = m.timestamp ? m.timestamp * 1000 : Date.now();

    switch (type) {
      case "USER_INPUT": {
        const content = typeof data.content === "string" ? data.content : "";
        if (!content) break;
        result.push({ id: m.id || histId(), role: "user", content, timestamp: ts });
        break;
      }

      case "tool_call": {
        const ast = currentAssistant(m.id || histId(), ts);
        if (!ast.toolCalls) ast.toolCalls = [];
        if (!ast.parts) ast.parts = [];
        const toolId = data.id || "";
        ast.toolCalls.push({
          id: toolId,
          name: data.name || "unknown",
          arguments: typeof data.arguments === "object"
            ? JSON.stringify(data.arguments)
            : data.arguments || "{}",
          status: "running",
        });
        // 按顺序记录 tool_call 位置
        ast.parts.push({ type: "tool_call", toolCallId: toolId });
        break;
      }

      case "tool_result": {
        const callId = data.id;
        const isError = !!data.error;
        for (let i = result.length - 1; i >= 0; i--) {
          const msg = result[i];
          if (msg.role === "user") break;
          if (msg.toolCalls) {
            const tc = msg.toolCalls.find((t) => t.id === callId);
            if (tc) {
              tc.status = isError ? "error" : "ok";
              tc.result = isError ? data.error : (data.result || "");
              break;
            }
          }
        }
        break;
      }

      case "message_complete": {
        const content = data.content || "";
        if (!content) break;
        const ast = currentAssistant(m.id || histId(), ts);
        ast.content = content;
        ast.id = m.id || ast.id;
        if (!ast.parts) ast.parts = [];
        // 按顺序记录 text 位置
        ast.parts.push({ type: "text", text: content });
        break;
      }

      // done / error / 其他 → 跳过
      default:
        break;
    }
  }

  return result.filter((m) => {
    if (m.role !== "assistant") return true;
    return m.content || (m.toolCalls && m.toolCalls.length > 0);
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
  /** Session ID currently being loaded (HTTP fetch in progress) */
  loadingSessionId: string | null;

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
  loadingSessionId: null,

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

    // Switch: clear messages, set sessionId
    useChat.setState({
      messages: [],
      progress: null,
      isBusy: false,
      error: null,
      sessionId,
      retryState: null,
      contextTokens: 0,
    });

    try {
      localStorage.setItem(sessionStorageKey(), sessionId);
    } catch {
      /* ignore */
    }

    // Fetch latest history from server if session is not currently busy
    if (useChat.getState().isBusy) {
      // Session is actively streaming — don't overwrite with stale HTTP data
      return;
    }

    set({ loadingSessionId: sessionId });

    fetchSessionMessages(sessionId)
      .then((msgs) => {
        if (!msgs || msgs.length === 0) return;
        const chatMessages = convertHistoryMessages(msgs);
        if (chatMessages.length === 0) return;
        // Load history into chat store
        useChat.setState({ messages: chatMessages });
      })
      .catch((err) => {
        console.error("[Session] switchSession fetch error:", err);
      })
      .finally(() => {
        if (get().loadingSessionId === sessionId) {
          set({ loadingSessionId: null });
        }
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
    const activeSessionId = useChat.getState().sessionId;
    if (activeSessionId === sessionId) {
      if (newTabs.length > 0) {
        const closedIndex = openTabs.indexOf(sessionId);
        const nextIndex = Math.min(closedIndex, newTabs.length - 1);
        get().switchSession(newTabs[nextIndex]);
      } else {
        useChat.getState().newChat();
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
    useChat.getState().newChat();
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
// TODO: Subscribe to chat store isBusy changes to refresh session list
// when a turn completes. For now, session list is refreshed on manual actions.
