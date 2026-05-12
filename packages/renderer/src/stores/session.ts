/**
 * Session store — tracks known chat sessions (local state).
 * Syncs with ws-stream-manager for session switching.
 */
import { create } from "zustand";
import { streamManager } from "@/services/ws-stream-manager";
import type { ChatMessage, InlineToolCall } from "@/services/ws-stream-manager";
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
 * Convert OpenAI-format messages from the REST API into ChatMessage[].
 * Pairs assistant tool_calls with subsequent tool results inline.
 */
function convertHistoryMessages(msgs: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];

    if (m.role === 'user') {
      let content = '';
      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
      }
      if (!content) continue;
      result.push({
        id: histId(),
        role: 'user',
        content,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      });
    } else if (m.role === 'assistant') {
      // Extract text content
      let content = '';
      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
      }

      // Pair tool_calls with subsequent tool results
      let inlineToolCalls: InlineToolCall[] | undefined;
      if (m.tool_calls?.length) {
        inlineToolCalls = m.tool_calls.map((tc: any) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch { /* malformed args */ }

          // Find matching tool result in subsequent messages
          let toolResult: string | undefined;
          let toolStatus: 'ok' | 'error' = 'ok';
          for (let j = i + 1; j < msgs.length && j <= i + m.tool_calls.length; j++) {
            if (msgs[j].role === 'tool' && msgs[j].tool_call_id === tc.id) {
              toolResult = msgs[j].content || '';
              break;
            }
          }

          return {
            call_id: tc.id || histId(),
            name: tc.function?.name || 'unknown',
            arguments: args,
            status: toolStatus,
            result: toolResult,
          };
        });
      }

      // Skip assistant messages that have no content AND no tool calls
      if (!content && !inlineToolCalls?.length) continue;

      result.push({
        id: histId(),
        role: 'assistant',
        content,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
        toolCalls: inlineToolCalls,
      });
    }
    // Skip role:"tool" — they're consumed by the assistant pairing above
  }

  return result;
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
    fetchSessionMessages(sessionId)
      .then((msgs) => {
        if (!msgs || msgs.length === 0) return;
        const chatMessages = convertHistoryMessages(msgs);
        if (chatMessages.length === 0) return;
        // syncHistory only emits if data actually changed
        streamManager.syncHistory(sessionId, chatMessages);
      })
      .catch(() => {
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
