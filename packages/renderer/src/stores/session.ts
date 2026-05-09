/**
 * Session store — tracks known chat sessions (local state).
 * Syncs with ws-stream-manager for session switching.
 */
import { create } from "zustand";
import { streamManager } from "@/services/ws-stream-manager";
import type { SessionSummary } from "@/services/api";
import { useWorkspace } from "./workspace";
import { useChat } from "./chat";
import { workspaceHash, normalizePathForCompare } from "@/utils/pathUtils";

export type { SessionSummary };

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
    // No backend to query yet — sessions are tracked locally
    set({ loading: false });
  },

  loadAllSessions: async () => {
    set({ loading: false });
  },

  loadWorkspaceSessions: async (_workspace: string) => {
    // No-op for now
  },

  switchSession: async (sessionId: string) => {
    // Add to open tabs
    const { openTabs } = get();
    if (!openTabs.includes(sessionId)) {
      const newTabs = [...openTabs, sessionId];
      set({ openTabs: newTabs });
      saveTabsToStorage(newTabs);
    }

    // Switch via stream manager
    streamManager.switchChat(sessionId);

    // Persist active session
    try {
      localStorage.setItem(sessionStorageKey(), sessionId);
    } catch {
      /* ignore */
    }
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
    // Restore open tabs from localStorage
    const savedTabs = loadTabsFromStorage();
    set({ openTabs: savedTabs });

    // Restore last active session
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
