/**
 * Session store — tracks known chat sessions (local state).
 *
 * History 加载：把后端记录直接转成 BusEvent 喂给 chat store 的统一 reducer
 * （applyEvent），不再维护一份与 dispatcher 同构的转换器。
 */
import { create } from "zustand";
import { useChat, type BusEvent } from "./chat";
import type { SessionSummary } from "@/services/api";
import { fetchSessions, fetchSessionMessages } from "@/services/api";
import { useWorkspace } from "./workspace";
import { workspaceHash, normalizePathForCompare } from "@/utils/pathUtils";

export type { SessionSummary };

// ─── History → BusEvent ─────────────────────────────────────────────

/**
 * 后端 history 记录: { id, session_id, type, data, timestamp }
 * timestamp 为 epoch 秒。
 *
 * 直接映射成 BusEvent 序列，由 chat store 的 applyEvent 同款消化。
 * 不在此做语义合并 / 拆分（与 ws 实时事件保持同一份逻辑）。
 */
function historyToEvents(records: any[]): BusEvent[] {
  return records.map((r) => ({
    type: String(r.type ?? ""),
    data: r.data ?? {},
    ts: r.timestamp ? r.timestamp * 1000 : undefined,
    id: r.id,
  }));
}

// ─── Storage Keys ───────────────────────────────────────────────────

const SESSION_KEY_PREFIX = "ftre-active-session";
const TABS_KEY_PREFIX = "ftre-open-tabs";

const sessionStorageKey = () => {
  const root = useWorkspace.getState().rootPath;
  return root ? `${SESSION_KEY_PREFIX}:${workspaceHash(root)}` : SESSION_KEY_PREFIX;
};
const tabsStorageKey = () => {
  const root = useWorkspace.getState().rootPath;
  return root ? `${TABS_KEY_PREFIX}:${workspaceHash(root)}` : TABS_KEY_PREFIX;
};

const loadTabsFromStorage = (): string[] => {
  try {
    const raw = localStorage.getItem(tabsStorageKey());
    if (raw) return JSON.parse(raw);
  } catch { }
  return [];
};
const saveTabsToStorage = (tabs: string[]) => {
  try {
    localStorage.setItem(tabsStorageKey(), JSON.stringify(tabs));
  } catch { }
};

// ─── State ──────────────────────────────────────────────────────────

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

  loadSessions: async (workspace) => {
    set({ loading: true });
    try {
      const sessions = await fetchSessions(workspace);
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

  loadWorkspaceSessions: async (workspace) => {
    set({ loading: true });
    try {
      const sessions = await fetchSessions(workspace);
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  switchSession: async (sessionId) => {
    const { openTabs } = get();
    if (!openTabs.includes(sessionId)) {
      const tabs = [...openTabs, sessionId];
      set({ openTabs: tabs });
      saveTabsToStorage(tabs);
    }

    // Switch via chat store — uses per-session cache so streaming state survives.
    useChat.getState().switchTo(sessionId);
    try { localStorage.setItem(sessionStorageKey(), sessionId); } catch { }

    // Stale-while-revalidate：缓存命中立刻显示；后台 fetch 一次最新数据。
    const isFirstLoad = !useChat.getState().hasSessionCache(sessionId);
    set({ loadingSessionId: sessionId });

    fetchSessionMessages(sessionId)
      .then((records) => {
        if (!records) return;
        useChat.getState().loadSessionEvents(
          sessionId,
          historyToEvents(records),
          isFirstLoad ? "hydrate" : "refresh",
        );
      })
      .catch((err) => console.error("[Session] switchSession fetch error:", err))
      .finally(() => {
        if (get().loadingSessionId === sessionId) set({ loadingSessionId: null });
      });
  },

  openTab: (sessionId) => {
    const { openTabs } = get();
    if (openTabs.includes(sessionId)) return;
    const tabs = [...openTabs, sessionId];
    set({ openTabs: tabs });
    saveTabsToStorage(tabs);
  },

  closeTab: (sessionId) => {
    const { openTabs } = get();
    const tabs = openTabs.filter((id) => id !== sessionId);
    set({ openTabs: tabs });
    saveTabsToStorage(tabs);
    if (useChat.getState().sessionId !== sessionId) return;
    if (tabs.length === 0) return useChat.getState().newChat();
    const closedIdx = openTabs.indexOf(sessionId);
    const nextIdx = Math.min(closedIdx, tabs.length - 1);
    get().switchSession(tabs[nextIdx]);
  },

  deleteSession: async (sessionId) => {
    get().closeTab(sessionId);
    set({
      sessions: get().sessions.filter((s) => s.session_id !== sessionId),
      allSessions: get().allSessions.filter((s) => s.session_id !== sessionId),
    });
  },

  newSession: (workspace) => {
    const currentWorkspace = useWorkspace.getState().rootPath;
    const isSameWorkspace =
      currentWorkspace &&
      workspace &&
      normalizePathForCompare(workspace) === normalizePathForCompare(currentWorkspace);
    if (workspace && !isSameWorkspace) useWorkspace.getState().setRootPath(workspace);
    const chat = useChat.getState();
    chat.newChat();
    chat.setAgentId("code_agent");
    // 不重置 model/provider —— 用户当前选择的模型是粘性偏好，
    // 跨会话保留体验更自然；首次打开时仍由 ModelSelector 从 config 读取默认值。
    try { localStorage.removeItem(sessionStorageKey()); } catch { }
  },

  patchSession: (sessionId, patch) => {
    set({
      sessions: get().sessions.map((s) => {
        if (s.session_id !== sessionId) return s;
        return {
          ...s,
          agent_id: patch.agentId ?? s.agent_id,
          meta: { ...s.meta, model: patch.model !== undefined ? patch.model : s.meta?.model },
        };
      }),
    });
  },

  restoreLatest: async () => {
    const savedTabs = loadTabsFromStorage();
    set({ openTabs: savedTabs });
    await get().loadSessions();
    let target: string | null = null;
    try { target = localStorage.getItem(sessionStorageKey()); } catch { }
    if (target) await get().switchSession(target);
    else if (savedTabs.length > 0) await get().switchSession(savedTabs[0]);
  },
}));
