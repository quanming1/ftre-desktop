import { create } from "zustand";
import type { SessionSummary } from "@/services/api";
import {
  fetchSessions,
  fetchSessionMessages,
  fetchUsage,
  deleteSession as apiDeleteSession,
} from "@/services/api";
import { streamManager } from "@/services/stream-manager";
import { useWorkspace } from "./workspace";
import { useChat } from "./chat";
import { workspaceHash, normalizePathForCompare } from "@/utils/pathUtils";

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
  /** 所有工作区的会话列表（用于 SessionPanel 展示所有工作区） */
  allSessions: SessionSummary[];
  /** 当前打开的 tab 列表（session_id 数组），本地持久化 */
  openTabs: string[];
  loading: boolean;
  /** 加载当前 workspace 的会话列表 */
  loadSessions: (workspace?: string | null) => Promise<void>;
  /** 加载所有工作区的会话列表 */
  loadAllSessions: () => Promise<void>;
  /** 加载指定工作区的会话列表并合并到 allSessions（用于展开时刷新） */
  loadWorkspaceSessions: (workspace: string) => Promise<void>;
  /** 切换到指定会话（同时加入 openTabs，如果是其他工作区会自动切换） */
  switchSession: (sessionId: string) => Promise<void>;
  /** 打开 tab（加入 openTabs，如果不存在的话） */
  openTab: (sessionId: string) => void;
  /** 关闭 tab（只从本地移除，不删除后端数据） */
  closeTab: (sessionId: string) => void;
  /** 删除会话（真正从后端删除，用于 SessionList） */
  deleteSession: (sessionId: string) => Promise<void>;
  /** 新建会话（在指定工作区，默认当前工作区） */
  newSession: (workspace?: string) => void;
  /** 加载会话列表并恢复上次活跃的会话（或最新的） */
  restoreLatest: (workspace?: string | null) => Promise<void>;
  /** 立即更新本地 sessions 数组中指定 session 的 meta/agent_id（发送消息后调用） */
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

  loadSessions: async (workspace) => {
    set({ loading: true });
    try {
      const sessions = await fetchSessions(workspace);
      set({ sessions });
    } finally {
      set({ loading: false });
    }
  },

  loadAllSessions: async () => {
    set({ loading: true });
    try {
      const allSessions = await fetchSessions();
      set({ allSessions });
    } finally {
      set({ loading: false });
    }
  },

  loadWorkspaceSessions: async (workspace: string) => {
    try {
      const workspaceSessions = await fetchSessions(workspace);
      const { allSessions } = get();
      // 合并：移除该工作区的旧会话，添加新会话
      const normalizedWorkspace = normalizePathForCompare(workspace);
      const filtered = allSessions.filter((s) => {
        if (!s.workspace) return true;
        return normalizePathForCompare(s.workspace) !== normalizedWorkspace;
      });
      set({ allSessions: [...filtered, ...workspaceSessions] });
    } catch {
      /* ignore */
    }
  },

  switchSession: async (sessionId: string) => {
    const existing = streamManager.getOrCreate(sessionId);

    // 加入 openTabs（如果不在的话）
    const { openTabs, sessions, allSessions } = get();
    if (!openTabs.includes(sessionId)) {
      const newTabs = [...openTabs, sessionId];
      set({ openTabs: newTabs });
      saveTabsToStorage(newTabs);
    }

    // 查找 session（先从当前 workspace 的 sessions 找，再从 allSessions 找）
    let target = sessions.find((s) => s.session_id === sessionId);
    if (!target) {
      target = allSessions.find((s) => s.session_id === sessionId);
    }

    // 如果 session 属于其他工作区，先切换工作区
    const currentWorkspace = useWorkspace.getState().rootPath;
    const isSameWorkspace =
      currentWorkspace &&
      target?.workspace &&
      normalizePathForCompare(target.workspace) ===
        normalizePathForCompare(currentWorkspace);
    if (target && target.workspace && !isSameWorkspace) {
      useWorkspace.getState().setRootPath(target.workspace);
    }

    streamManager.switchTo(sessionId);

    // 从 session 恢复 model（meta.model）和 agent（agent_id 字段）
    const chatStore = useChat.getState();
    // 恢复 model：有 meta.model 则用之，否则默认
    if (target?.meta && "model" in target.meta) {
      chatStore.setModel(target.meta.model ?? null);
    } else {
      chatStore.setModel(null);
    }
    // 恢复 agent：直接用 session 已有的 agent_id 字段
    chatStore.setAgentId(target?.agent_id || "code_agent");

    // 持久化当前活跃的 sessionId
    try {
      localStorage.setItem(sessionStorageKey(), sessionId);
    } catch {
      /* ignore */
    }

    // 始终从后端加载完整历史。
    // replayInto 内部会处理流式状态：如果 session 正在流式中，
    // 会保留未入库的流式增量并追加在历史末尾。
    fetchSessionMessages(sessionId).then((events) => {
      streamManager.replayInto(sessionId, events);
    });

    fetchUsage(sessionId).then((tokens) => {
      existing.setContextTokens(tokens);
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

    // 如果关闭的是当前活跃的 tab，切换到相邻的
    const active = streamManager.getActive();
    if (active?.sessionId === sessionId) {
      if (newTabs.length > 0) {
        // 切换到关闭位置的前一个，或第一个
        const closedIndex = openTabs.indexOf(sessionId);
        const nextIndex = Math.min(closedIndex, newTabs.length - 1);
        get().switchSession(newTabs[nextIndex]);
      } else {
        streamManager.newSession();
      }
    }

    // 从 streamManager 中移除（释放内存，但不删后端数据）
    // 如果 session 正在流式中，保留它（后台流继续跑，下次切换时能接上）
    if (!streamManager.isSessionStreaming(sessionId)) {
      streamManager.removeSession(sessionId);
    }
  },

  deleteSession: async (sessionId: string) => {
    // 真正删除：先关闭 tab，再调后端 API
    get().closeTab(sessionId);
    await apiDeleteSession(sessionId);
    // 刷新列表（同时更新 sessions 和 allSessions）
    set({
      sessions: get().sessions.filter((s) => s.session_id !== sessionId),
      allSessions: get().allSessions.filter((s) => s.session_id !== sessionId),
    });
  },

  newSession: (workspace?: string) => {
    // 如果指定了工作区且不是当前工作区，先切换
    const currentWorkspace = useWorkspace.getState().rootPath;
    const isSameWorkspace =
      currentWorkspace &&
      workspace &&
      normalizePathForCompare(workspace) ===
        normalizePathForCompare(currentWorkspace);
    if (workspace && !isSameWorkspace) {
      useWorkspace.getState().setRootPath(workspace);
    }
    streamManager.newSession();
    // 重置 agent 为默认值（Ftre）、model 为默认
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

  restoreLatest: async (workspace) => {
    await get().loadSessions(workspace);
    const sessions = get().sessions;

    // 恢复 openTabs
    const savedTabs = loadTabsFromStorage();
    // 过滤掉不存在的 session
    const validTabs = savedTabs.filter((id) =>
      sessions.some((s) => s.session_id === id),
    );
    set({ openTabs: validTabs });
    saveTabsToStorage(validTabs);

    if (sessions.length === 0) return;

    // 优先恢复上次活跃的会话
    let targetSessionId: string | null = null;
    try {
      targetSessionId = localStorage.getItem(sessionStorageKey());
    } catch {
      /* ignore */
    }

    if (
      targetSessionId &&
      sessions.some((s) => s.session_id === targetSessionId)
    ) {
      await get().switchSession(targetSessionId);
    } else if (validTabs.length > 0) {
      await get().switchSession(validTabs[0]);
    } else {
      await get().switchSession(sessions[0].session_id);
    }
  },
}));
