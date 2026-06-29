/**
 * Session store — tracks known chat sessions (local state).
 *
 * History 加载：把后端记录直接转成 BusEvent 喂给 chat store 的统一 reducer
 * （applyEvent），不再维护一份与 dispatcher 同构的转换器。
 */
import { create } from "zustand";
import { useChat, type BusEvent } from "./chat";
import type { SessionSummary } from "@/services/api";
import {
  fetchSessionPage,
  fetchWorkspaces,
  fetchSessionMessages,
  fetchSessionMessagesPage,
  deleteSessionRemote,
} from "@/services/api";
import { useWorkspace } from "./workspace";
import { workspaceHash } from "@/utils/pathUtils";
import { wsClient } from "@/services/websocket-client";

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

/**
 * 会话列表分页参数。
 * - 默认每页 50；轮询只刷首页（拿到最新创建/最新活跃的）；面板里点"展开 +10 条"
 *   走 loadMoreSessions(10) 累加。
 * - 总数由 fetchSessionPage 返回的 total 维护，前端据此判断"还能继续往下翻吗"。
 */
const FIRST_PAGE_SIZE = 50;

/**
 * 单个 session 内的首屏对话轮数。
 * - 1 轮 = 一个可见 user_message 到下一个之间的所有事件
 * - 5 轮足够覆盖首屏可见范围，用户翻到顶部时再加载更早的
 */
const FIRST_PAGE_TURNS = 5;

/** 上一次 switchSession 的 AbortController，新切换时取消旧请求 */
let _switchAbort: AbortController | null = null;

/** 每个工作区首屏拉取的 session 数 */
const WORKSPACE_PAGE_SIZE = 20;

/** 工作区分页状态 */
interface WorkspacePaging {
  /** 该工作区后端总会话数 */
  total: number;
  /** 已加载条数（= offset，用于继续翻页） */
  loaded: number;
}

interface SessionState {
  sessions: SessionSummary[];
  allSessions: SessionSummary[];
  /** 后端总会话数；用于判断 hasMore */
  sessionsTotal: number;
  /** 每个工作区的分页状态：workspace 路径（""=未设置）→ { total, loaded } */
  workspacePaging: Record<string, WorkspacePaging>;
  openTabs: string[];
  loading: boolean;
  /** Session ID currently being loaded (HTTP fetch in progress) */
  loadingSessionId: string | null;

  loadSessions: (workspace?: string | null) => Promise<void>;
  /** 枚举工作区 + 为每个工作区拉首页 session（轮询、初始加载用） */
  loadAllSessions: () => Promise<void>;
  /** 在 allSessions 末尾追加 extraCount 条（兼容旧调用，等价于全局补拉） */
  loadMoreSessions: (extraCount: number) => Promise<void>;
  /** 为指定工作区多拉一页 session（"展开"按钮用） */
  loadMoreWorkspaceSessions: (workspace: string, extraCount: number) => Promise<void>;
  loadWorkspaceSessions: (workspace: string) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  /** 加载更早一页消息（基于当前桶最早事件的 timestamp 作 before_ts）。返回是否真的拉到内容。 */
  loadEarlierMessages: (sessionId: string) => Promise<boolean>;
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

/** 按 session_id 去重，保持出现顺序（前面的优先） */
function dedupeById(list: SessionSummary[]): SessionSummary[] {
  const seen = new Set<string>();
  const out: SessionSummary[] = [];
  for (const s of list) {
    if (seen.has(s.session_id)) continue;
    seen.add(s.session_id);
    out.push(s);
  }
  return out;
}

export const useSession = create<SessionState>((set, get) => ({
  sessions: [],
  allSessions: [],
  sessionsTotal: 0,
  workspacePaging: {},
  openTabs: [],
  loading: false,
  loadingSessionId: null,

  loadSessions: async (_workspace) => {
    // 兼容旧调用：等价于 loadAllSessions
    await get().loadAllSessions();
  },

  loadAllSessions: async () => {
    set({ loading: true });
    try {
      // 1) 枚举所有 ws 工作区（按各自最新活跃倒序）
      const workspaces = await fetchWorkspaces("ws");

      // 2) 为每个工作区并发拉首页 session（每页 WORKSPACE_PAGE_SIZE 条）
      //    这样很久没活跃的工作区也能出现，不会被全局分页漏掉
      const pages = await Promise.all(
        workspaces.map((w) =>
          fetchSessionPage({
            workspace: w.workspace,
            channelId: "ws",
            limit: WORKSPACE_PAGE_SIZE,
            offset: 0,
          }).then((page) => ({ workspace: w.workspace, page })),
        ),
      );

      // 3) 同时拉一页非 ws 的 session（cron / cli / telegram 等，平铺在 Other Threads）
      const otherPage = await fetchSessionPage({ limit: FIRST_PAGE_SIZE, offset: 0 });
      const otherSessions = otherPage.sessions.filter((s) => s.channel !== "ws");

      // 4) 合并：保留已加载的更多页（loadMoreWorkspaceSessions 拉过的尾部数据不丢）
      const existing = get().allSessions;
      const existingByWs = new Map<string, SessionSummary[]>();
      for (const s of existing) {
        if (s.channel !== "ws") continue;
        const ws = s.workspace || "";
        if (!existingByWs.has(ws)) existingByWs.set(ws, []);
        existingByWs.get(ws)!.push(s);
      }

      const wsPaging: Record<string, WorkspacePaging> = {};
      const merged: SessionSummary[] = [];
      for (const { workspace, page } of pages) {
        // 首页结果 + 已加载的更多页，去重
        const prev = existingByWs.get(workspace) || [];
        const combined = dedupeById([...page.sessions, ...prev]);
        // loaded 取 max(首页条数, 已加载条数)，但不超过 total
        const loaded = Math.min(
          Math.max(page.sessions.length, prev.length),
          page.total,
        );
        wsPaging[workspace] = { total: page.total, loaded };
        merged.push(...combined.slice(0, Math.max(combined.length, loaded)));
      }
      merged.push(...otherSessions);

      const deduped = dedupeById(merged);
      const total = deduped.length;
      set({
        allSessions: deduped,
        sessions: deduped,
        sessionsTotal: total,
        workspacePaging: wsPaging,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  loadMoreSessions: async (_extraCount) => {
    // 旧的全局"加载更多"已被按工作区分页取代；保留兼容，整体刷新一遍
    await get().loadAllSessions();
  },

  loadMoreWorkspaceSessions: async (workspace, extraCount) => {
    const ws = workspace || "";
    const paging = get().workspacePaging[ws];
    if (paging && paging.loaded >= paging.total) return;
    const offset = paging ? paging.loaded : 0;
    const limit = Math.max(1, Math.floor(extraCount));
    set({ loading: true });
    try {
      const page = await fetchSessionPage({
        workspace: ws,
        channelId: "ws",
        limit,
        offset,
      });
      const merged = dedupeById([...get().allSessions, ...page.sessions]);
      const newLoaded = Math.min(offset + page.sessions.length, page.total);
      set({
        allSessions: merged,
        sessions: merged,
        sessionsTotal: merged.length,
        workspacePaging: {
          ...get().workspacePaging,
          [ws]: { total: page.total, loaded: newLoaded },
        },
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  loadWorkspaceSessions: async (workspace) => {
    await get().loadMoreWorkspaceSessions(workspace, WORKSPACE_PAGE_SIZE);
  },

  switchSession: async (sessionId) => {
    const { openTabs } = get();
    if (!openTabs.includes(sessionId)) {
      const tabs = [...openTabs, sessionId];
      set({ openTabs: tabs });
      saveTabsToStorage(tabs);
    }

    // 取消上一次切换的请求，避免浪费带宽
    _switchAbort?.abort();
    _switchAbort = new AbortController();
    const signal = _switchAbort.signal;

    // 暂时禁用本地缓存：每次切换都清空 bucket，走 HTTP + WS 全量加载
    useChat.getState().clearSessionCache(sessionId);

    set({ loadingSessionId: sessionId });

    // 切到目标 session（bucket 已清空，UI 展示 loading 转圈）
    useChat.getState().switchTo(sessionId);
    try { localStorage.setItem(sessionStorageKey(), sessionId); } catch { }

    // HTTP 先行：拉 DB 历史（最近 5 轮），loadSessionEvents 重建消息
    fetchSessionMessagesPage(sessionId, { limitTurns: FIRST_PAGE_TURNS, signal } as any)
      .then((page) => {
        if (!page) return;
        useChat.getState().loadSessionEvents(
          sessionId,
          historyToEvents(page.messages),
          "hydrate",
        );
        useChat.getState().prependSessionEvents(sessionId, [], page.hasMore);
        useChat.getState().setSessionRunning(sessionId, page.status === "running");
        // HTTP 完成后再 WS attach：volatile replay 只会追加到 DB 历史后面，
        // 不会和 loadSessionEvents 的清空操作竞争。
        wsClient.subscribeOnly(sessionId);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        console.error("[Session] switchSession fetch error:", err);
      })
      .finally(() => {
        if (get().loadingSessionId === sessionId) set({ loadingSessionId: null });
      });
  },

  loadEarlierMessages: async (sessionId) => {
    const chat = useChat.getState();
    if (!chat.hasMoreHistory(sessionId)) return false;
    const earliestTs = chat.getEarliestEventTs(sessionId);
    if (earliestTs == null) return false;

    try {
      const page = await fetchSessionMessagesPage(sessionId, {
        limitTurns: FIRST_PAGE_TURNS,
        beforeTs: earliestTs,
      });
      chat.prependSessionEvents(
        sessionId,
        historyToEvents(page.messages),
        page.hasMore,
      );
      return page.messages.length > 0;
    } catch (err) {
      console.error("[Session] loadEarlierMessages error:", err);
      return false;
    }
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
    // 清除该 session 的输入框草稿
    try {
      const { deleteSessionDraft } = await import("@/features/chat/sessionDrafts");
      deleteSessionDraft(sessionId);
    } catch { /* 静默 */ }
    // 后端先删；本地状态总是同步到 UI（即便后端失败也至少把它从列表里去掉，
    // 下一轮 5s 轮询会重新带回，让用户看到错误信号）
    void deleteSessionRemote(sessionId);
    const removed = get().allSessions.find((s) => s.session_id === sessionId);
    const total = get().sessionsTotal;
    // 同步该会话所属工作区的分页计数
    const paging = { ...get().workspacePaging };
    if (removed && removed.channel === "ws") {
      const ws = removed.workspace || "";
      const p = paging[ws];
      if (p) {
        paging[ws] = {
          total: Math.max(0, p.total - 1),
          loaded: Math.max(0, p.loaded - 1),
        };
      }
    }
    set({
      sessions: get().sessions.filter((s) => s.session_id !== sessionId),
      allSessions: get().allSessions.filter((s) => s.session_id !== sessionId),
      sessionsTotal: total > 0 ? total - 1 : 0,
      workspacePaging: paging,
    });
  },

  newSession: (workspace) => {
    const chat = useChat.getState();
    chat.newChat();
    chat.setAgentId("code_agent");
    // 不重置 model/provider —— 用户当前选择的模型是粘性偏好，
    // 跨会话保留体验更自然；首次打开时仍由 ModelSelector 从 config 读取默认值。
    // 传入 workspace（可选）：把它写到 chat 的 pendingWorkspace，发首条消息
    // 创建 session 时会作为 query param 落到 sessions.workspace 字段。
    if (workspace !== undefined) {
      chat.setPendingWorkspace(workspace || null);
    }
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
