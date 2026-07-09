/**
 * SessionPanel — 会话列表（侧边栏，工作区分组 + 顶部模式切换 + 底部设置）
 *
 * 视觉：
 *   - 工作区作为不可折叠的标题行（📁 + basename）
 *   - 当前 rootPath 对应的组头有底色和加粗高亮，单击其他组头可切 rootPath
 *   - 每组默认显示 5 条；点击"展开 +N"会调用 store.loadMoreSessions(10)
 *   - 活跃会话用浅灰底+加粗黑字
 *   - 时间右对齐，hover 时被『更多』按钮通过透明度切换覆盖（不重排）
 *
 * 排序：
 *   - 桶完全来自 sessions 自身的 workspace 字段
 *   - 当前 rootPath 对应的组优先冒顶；其余按组内最新一条 updated_at 倒序
 *   - "未设置工作区"压底
 *
 * 数据：
 *   - 后端按 updated_at 倒序分页（GET /api/sessions?limit&offset）
 *   - 5s 轮询只刷首页（最新创建/活跃）
 */
import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  Loader2,
  Pencil,
  Copy,
  Folder,
  FolderOpen,
  SquarePen,
  Clock,
  Zap,
  Settings,
  Pin,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  Palette,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSession } from "@/stores/session";
import { useChat } from "@/stores/chat";
import { useWorkspace } from "@/stores/workspace";
import { useLayout } from "@/stores/layout";
import { useNotification } from "@/stores/notification";
import { updateSession } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { normalizePathForCompare } from "@/utils/pathUtils";
import type { SessionSummary } from "@/services/api";

// ─── 水波纹 hook + 渲染组件（通用） ─────────────────────────────────

interface RippleItem {
  id: number;
  x: number;
  y: number;
  size: number;
}

function useRipple() {
  const [ripples, setRipples] = useState<RippleItem[]>([]);
  const idRef = useRef(0);
  const trigger = useCallback((e: React.MouseEvent<Element>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const id = ++idRef.current;
    setRipples((prev) => [
      ...prev,
      { id, x: e.clientX - rect.left - size / 2, y: e.clientY - rect.top - size / 2, size },
    ]);
  }, []);
  const remove = useCallback(
    (id: number) => setRipples((prev) => prev.filter((p) => p.id !== id)),
    [],
  );
  return { ripples, trigger, remove };
}

function RippleLayer({
  items,
  onEnd,
}: {
  items: RippleItem[];
  onEnd: (id: number) => void;
}) {
  return (
    <>
      {items.map((r) => (
        <span
          key={r.id}
          className="ftre-ripple"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
          onAnimationEnd={() => onEnd(r.id)}
        />
      ))}
    </>
  );
}

// ─── 工具 ──────────────────────────────────────────────────────────

function timeAgo(ts: number): { text: string; opacity: number } {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return { text: "now", opacity: 1 };
  if (diff < 3600) return { text: `${Math.floor(diff / 60)}m`, opacity: 0.9 };
  if (diff < 86400) return { text: `${Math.floor(diff / 3600)}h`, opacity: 0.7 };
  if (diff < 604800) return { text: `${Math.floor(diff / 86400)}d`, opacity: 0.5 };
  return { text: `${Math.floor(diff / 604800)}w`, opacity: 0.4 };
}

const NONE_KEY = "__none__";

function workspaceLabel(workspace: string | undefined | null): {
  name: string;
  full: string;
} {
  const ws = (workspace || "").trim();
  if (!ws) return { name: "未设置工作区", full: "" };
  const parts = ws.replace(/\\/g, "/").split("/").filter(Boolean);
  return { name: parts[parts.length - 1] || ws, full: ws };
}

function workspaceKey(workspace: string | undefined | null): string {
  const ws = (workspace || "").trim();
  if (!ws) return NONE_KEY;
  return normalizePathForCompare(ws);
}

// 工作区彩色识别（hash 调色板，用一个小色点辨识）
const FOLDER_PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#06b6d4", "#3b82f6", "#f97316",
  "#14b8a6", "#e11d48", "#a855f7", "#84cc16",
] as const;

function folderColor(key: string): string {
  if (key === NONE_KEY) return "var(--color-t-ghost)";
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return FOLDER_PALETTE[Math.abs(h) % FOLDER_PALETTE.length];
}

const CHANNEL_SUFFIX: Record<string, string> = {
  cron: "cron",
  dmwork: "dmwork",
  cli: "cli",
  telegram: "telegram",
};

function channelSuffix(channel?: string): string {
  if (!channel || channel === "ws") return "";
  return CHANNEL_SUFFIX[channel] || channel;
}

// ─── 类型 ──────────────────────────────────────────────────────────

interface WorkspaceBucket {
  key: string;
  name: string;
  full: string;
  sessions: SessionSummary[];
  /** 组内最新 updated_at，用于排序 */
  latestAt: number;
  /** 是否当前 rootPath 对应的组 */
  isActive: boolean;
}

const PER_GROUP_DEFAULT = 2;
const PER_GROUP_STEP = 5;

// 工作区分组顺序持久化（与 recentFolders 解耦：纯前端排序偏好）
const GROUP_ORDER_STORAGE_KEY = "ftre-session-group-order";
const PINNED_SESSIONS_KEY = "ftre-pinned-sessions";
const PINNED_SESSION_COLORS_KEY = "ftre-pinned-session-colors";

const DOT_PALETTE = [
  "#e11d48", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
];

const COLLAPSED_WORKSPACES_KEY = "ftre-collapsed-workspaces";

function loadCollapsedWorkspaces(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_WORKSPACES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedWorkspaces(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_WORKSPACES_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* ignore */
  }
}

function loadGroupOrder(): string[] {
  try {
    const raw = localStorage.getItem(GROUP_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveGroupOrder(order: string[]): void {
  try {
    localStorage.setItem(GROUP_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

function loadPinnedSessions(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function savePinnedSessions(pinned: Set<string>): void {
  try {
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify([...pinned]));
  } catch {
    /* ignore */
  }
}

function loadPinnedSessionColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PINNED_SESSION_COLORS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePinnedSessionColors(colors: Record<string, string>): void {
  try {
    localStorage.setItem(PINNED_SESSION_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* ignore */
  }
}

// ─── 主组件 ──────────────────────────────────────────────────────

export function SessionPanel() {
  const allSessions = useSession((s) => s.allSessions);
  const workspacePaging = useSession((s) => s.workspacePaging);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const loadMoreWorkspaceSessions = useSession((s) => s.loadMoreWorkspaceSessions);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const newSession = useSession((s) => s.newSession);
  const loadingSessionId = useSession((s) => s.loadingSessionId);
  const currentSessionId = useChat((s) => s.sessionId);

  const rootPath = useWorkspace((s) => s.rootPath);

  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);
  const setActiveLeftPanel = useLayout((s) => s.setActiveLeftPanel);
  const locateTraceSession = useLayout((s) => s.locateTraceSession);
  const sessionsCollapsed = useLayout((s) => s.sessionsCollapsed);
  const sessionsWidth = useLayout((s) => s.sessionsWidth);
  const toggleSessionsCollapsed = useLayout((s) => s.toggleSessionsCollapsed);

  // ── 折叠态悬停浮层 ──
  const [hoverListOpen, setHoverListOpen] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedRef = useRef<HTMLDivElement>(null);
  const openHoverList = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverListOpen(true);
  }, []);
  const closeHoverList = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverListOpen(false), 200);
  }, []);
  useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }, []);

  // 计算浮层位置：紧贴折叠栏右侧
  const [overlayPos, setOverlayPos] = useState({ top: 0, left: 0, height: 0 });
  useEffect(() => {
    if (!hoverListOpen || !collapsedRef.current) return;
    const rect = collapsedRef.current.getBoundingClientRect();
    setOverlayPos({ top: rect.top, left: rect.right + 4, height: rect.height });
  }, [hoverListOpen]);

  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  /** 每个 group 已展开多少条；未列入即 PER_GROUP_DEFAULT */
  const [expandCount, setExpandCount] = useState<Record<string, number>>({});
  /** 用户拖动后的工作区分组顺序；空数组表示走默认排序 */
  const [groupOrder, setGroupOrder] = useState<string[]>(() => loadGroupOrder());
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [renamingSession, setRenamingSession] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  /** 置顶会话 ID 集合（纯前端，localStorage 持久化） */
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(() => loadPinnedSessions());
  /** 每个置顶会话的自定义颜色（session_id → hex） */
  const [pinnedColors, setPinnedColors] = useState<Record<string, string>>(() => loadPinnedSessionColors());
  /** 折叠的工作区 key 集合（纯前端，localStorage 持久化） */
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => loadCollapsedWorkspaces());
  /** 是否展示全部工作区（默认最多 5 个） */
  const [showAllGroups, setShowAllGroups] = useState(false);
  /** 颜色选择器：{ sessionId, 锚点坐标 } */
  const [colorPicker, setColorPicker] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  const handleSetSessionColor = useCallback((sessionId: string, color: string | null) => {
    setPinnedColors((prev) => {
      const next = { ...prev };
      if (color === null) {
        delete next[sessionId];
      } else {
        next[sessionId] = color;
      }
      savePinnedSessionColors(next);
      return next;
    });
    setColorPicker(null);
  }, []);

  const getSessionColor = useCallback(
    (sessionId: string) => pinnedColors[sessionId],
    [pinnedColors],
  );

  // 初次加载 + 5s 轮询
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions]);
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadAllSessions();
    };
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [loadAllSessions]);

  /**
   * 一级分流：
   * - ws channel：进 workspace 分组的 "Ws Threads"；
   * - 其它（cron/dmwork/cli/telegram/unknown）：平铺进 "Other Threads"
   */
  const { pinnedList, wsSessions, otherSessions } = useMemo(() => {
    const pinned: SessionSummary[] = [];
    const ws: SessionSummary[] = [];
    const others: SessionSummary[] = [];
    for (const s of allSessions) {
      if (pinnedSessions.has(s.session_id)) {
        pinned.push(s);
      } else if (s.channel === "ws") {
        ws.push(s);
      } else {
        others.push(s);
      }
    }
    pinned.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    others.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    return { pinnedList: pinned, wsSessions: ws, otherSessions: others };
  }, [allSessions, pinnedSessions]);

  /**
   * 桶顺序（仅 ws sessions 走分组）：
  /**
   * 桶顺序（仅 ws sessions 走分组）：
   * 1. 用户拖动过 → 按 groupOrder（已知组），未在序列里的新组按默认规则追加
   * 2. 默认规则：active workspace 冒顶 → 其余按 latestAt 倒序 → "未设置工作区"压底
   */
  const buckets = useMemo<WorkspaceBucket[]>(() => {
    const map = new Map<string, WorkspaceBucket>();
    for (const s of wsSessions) {
      const key = workspaceKey(s.workspace);
      let g = map.get(key);
      if (!g) {
        const { name, full } = workspaceLabel(s.workspace);
        g = { key, name, full, sessions: [], latestAt: 0, isActive: false };
        map.set(key, g);
      }
      g.sessions.push(s);
      const ts = s.updated_at ?? 0;
      if (ts > g.latestAt) g.latestAt = ts;
    }
    for (const g of map.values()) {
      g.sessions.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    }

    const activeKey = rootPath ? workspaceKey(rootPath) : null;
    for (const g of map.values()) {
      g.isActive = g.key === activeKey;
    }

    const all = [...map.values()];
    const defaultSort = (a: WorkspaceBucket, b: WorkspaceBucket) => {
      if (a.isActive && !b.isActive) return -1;
      if (b.isActive && !a.isActive) return 1;
      if (a.key === NONE_KEY && b.key !== NONE_KEY) return 1;
      if (b.key === NONE_KEY && a.key !== NONE_KEY) return -1;
      return b.latestAt - a.latestAt;
    };

    if (groupOrder.length === 0) return all.sort(defaultSort);

    const orderIdx = new Map<string, number>();
    groupOrder.forEach((k, i) => orderIdx.set(k, i));
    const known: WorkspaceBucket[] = [];
    const unknown: WorkspaceBucket[] = [];
    for (const g of all) {
      if (orderIdx.has(g.key)) known.push(g);
      else unknown.push(g);
    }
    known.sort((a, b) => orderIdx.get(a.key)! - orderIdx.get(b.key)!);
    unknown.sort(defaultSort);
    return [...known, ...unknown];
  }, [wsSessions, rootPath, groupOrder]);

  const totalCount = allSessions.length;

  /** Other Threads 默认折叠展示 PER_GROUP_DEFAULT 条；用同样的展开/收起按钮 */
  const OTHER_KEY = "__other__";
  const otherExpanded = expandCount[OTHER_KEY] ?? PER_GROUP_DEFAULT;
  const otherVisible = otherSessions.slice(0, otherExpanded);
  const otherHidden = otherSessions.length - otherVisible.length;
  const otherIsExpanded = otherExpanded > PER_GROUP_DEFAULT;

  // ─── 操作 ────────────────────────────────────────────────────────

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      if (activeLeftPanel !== "chat") setActiveLeftPanel("chat");
      switchSession(sessionId);
    },
    [activeLeftPanel, setActiveLeftPanel, switchSession],
  );

  // Alt+↑ / Alt+↓ → 在"可见会话"列表里上下切换
  // 可见会话 = 置顶 + 各 workspace 展开的部分（未折叠的） + Other Threads 展开的部分
  // 用 ref 拿最新值，避免事件 listener 反复重新绑定
  const navRef = useRef({
    pinnedList,
    wsSessions,
    otherSessions,
    otherExpanded,
    buckets,
    expandCount,
    collapsedWorkspaces,
    showAllGroups,
    currentSessionId,
    handleSwitchSession,
  });
  navRef.current = {
    pinnedList,
    wsSessions,
    otherSessions,
    otherExpanded,
    buckets,
    expandCount,
    collapsedWorkspaces,
    showAllGroups,
    currentSessionId,
    handleSwitchSession,
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ direction: "up" | "down" }>).detail;
      const s = navRef.current;
      if (!detail) return;

      // 1. 收集"可见会话"，DOM 顺序：Pin → Ws (按桶顺序) → Other
      const visible: SessionSummary[] = [];
      visible.push(...s.pinnedList);

      const wsVisibleBucketKeys = s.showAllGroups
        ? s.buckets.map((b) => b.key)
        : s.buckets.slice(0, 5).map((b) => b.key);
      const visibleBuckets = s.buckets.filter((b) => wsVisibleBucketKeys.includes(b.key));

      for (const b of visibleBuckets) {
        if (s.collapsedWorkspaces.has(b.key)) continue;
        const expand = s.expandCount[b.key] ?? PER_GROUP_DEFAULT;
        visible.push(...b.sessions.slice(0, expand));
      }

      if (s.otherSessions.length > 0) {
        visible.push(...s.otherSessions.slice(0, s.otherExpanded));
      }

      if (visible.length === 0) return;

      // 2. 找当前 session 的索引（用 stripPrefix 对齐比较方式，跟 SessionRow 内的 active 判断一致）
      const strip = (id: string) => (id.includes(":") ? id.substring(id.indexOf(":") + 1) : id);
      const cur = s.currentSessionId || "";
      const curIdx = visible.findIndex((it) => strip(it.session_id) === strip(cur));

      // 3. 找下一个 / 上一个；如果当前没在列表里，↓ 跳到第一个，↑ 跳到最后一个
      let next: SessionSummary | undefined;
      if (curIdx < 0) {
        next = detail.direction === "down" ? visible[0] : visible[visible.length - 1];
      } else {
        const offset = detail.direction === "down" ? 1 : -1;
        // 到边界时停止（不循环），避免误触把当前会话跳走
        const idx = curIdx + offset;
        if (idx < 0 || idx >= visible.length) return;
        next = visible[idx];
      }

      if (!next) return;
      s.handleSwitchSession(next.session_id);
    };
    window.addEventListener("ftre:session-nav", handler);
    return () => window.removeEventListener("ftre:session-nav", handler);
  }, []);

  /**
   * 点击工作区组头：在该工作区下新建会话，并切到 chat 模式。
   * （不再切 rootPath；新建一个 session 会带上 workspace 字段，用户自然就在这个 bucket 里看到新会话。）
   */
  const handleNewInWorkspace = useCallback(
    (full: string) => {
      if (activeLeftPanel !== "chat") setActiveLeftPanel("chat");
      newSession(full || undefined);
    },
    [activeLeftPanel, setActiveLeftPanel, newSession],
  );

  const handleTogglePin = useCallback((sessionId: string) => {
    setPinnedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      savePinnedSessions(next);
      return next;
    });
  }, []);

  const handleToggleCollapse = useCallback((workspaceKey: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceKey)) next.delete(workspaceKey);
      else next.add(workspaceKey);
      saveCollapsedWorkspaces(next);
      return next;
    });
  }, []);

  const handleRenameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      if (!newTitle.trim()) return;
      const result = await updateSession(sessionId, { title: newTitle.trim() });
      const ok = result && "status" in result && result.status === "updated";
      if (ok) loadAllSessions();
      useNotification.getState().addNotification({
        level: ok ? "info" : "error",
        message: ok ? "会话已重命名" : "重命名失败",
      });
      setRenamingSession(null);
    },
    [loadAllSessions],
  );

  const showSessionMenu = useCallback(
    (e: React.MouseEvent, session: SessionSummary) => {
      e.stopPropagation();
      e.preventDefault();
      const isPinned = pinnedSessions.has(session.session_id);
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "pin-session",
            label: isPinned ? "取消置顶" : "置顶",
            icon: Pin,
            action: () => handleTogglePin(session.session_id),
          },
          {
            id: "set-session-color",
            label: "设置色块",
            icon: Palette,
            action: () => {
              setContextMenu(null);
              setColorPicker({
                sessionId: session.session_id,
                x: e.clientX,
                y: e.clientY,
              });
            },
          },
          {
            id: "copy-session-id",
            label: "复制 Session ID",
            icon: Copy,
            action: () => navigator.clipboard.writeText(session.session_id),
          },
          {
            id: "locate-trace",
            label: "定位 Trace",
            icon: Activity,
            action: () => locateTraceSession(session.session_id),
          },
          {
            id: "rename-session",
            label: "重命名",
            icon: Pencil,
            action: () => {
              setRenameValue(session.title || "");
              setRenamingSession(session);
            },
          },
          { id: "sep", label: "", separator: true, action: () => { } },
          {
            id: "delete-session",
            label: "删除会话",
            action: () => deleteSession(session.session_id),
          },
        ],
      });
    },
    [deleteSession, handleTogglePin, locateTraceSession, pinnedSessions],
  );

  /** 工作区 header 右键菜单 */
  const showWorkspaceHeaderMenu = useCallback(
    (e: React.MouseEvent, workspacePath: string) => {
      e.stopPropagation();
      e.preventDefault();
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "new-session-in-workspace",
            label: "新建会话",
            icon: SquarePen,
            action: () => handleNewInWorkspace(workspacePath),
          },
        ],
      });
    },
    [handleNewInWorkspace],
  );

  const handleExpandGroup = useCallback(async (key: string, groupFull: string, groupTotal: number) => {
    // 当前展开数；未记录则视作默认 5
    const current = expandCount[key] ?? PER_GROUP_DEFAULT;
    const next = current + PER_GROUP_STEP;
    setExpandCount((prev) => ({ ...prev, [key]: next }));

    // Other Threads 组（非 ws）没有后端按 workspace 分页，纯前端展开即可
    if (key === OTHER_KEY) return;

    // 如果展开数超过了已加载的会话数，且后端该工作区还有更多，按工作区拉下一页
    const paging = workspacePaging[groupFull || ""];
    const hasMoreInBackend = paging ? paging.loaded < paging.total : false;
    if (next > groupTotal && hasMoreInBackend) {
      setLoadingMore(true);
      try {
        await loadMoreWorkspaceSessions(groupFull || "", PER_GROUP_STEP);
      } finally {
        setLoadingMore(false);
      }
    }
  }, [expandCount, workspacePaging, loadMoreWorkspaceSessions]);

  const handleCollapseGroup = useCallback((key: string) => {
    setExpandCount((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // ─── 顶层动作 ────────────────────────────────────────────────────

  /** New thread —— 在当前工作区下新建会话；若不在 chat 模式则切回 */
  const handleNewThread = useCallback(() => {
    if (activeLeftPanel !== "chat") setActiveLeftPanel("chat");
    newSession(rootPath || undefined);
  }, [activeLeftPanel, setActiveLeftPanel, newSession, rootPath]);

  /** 切换到设置面板 */
  const handleOpenSettings = useCallback(() => {
    setActiveLeftPanel("settings");
  }, [setActiveLeftPanel]);

  // ─── 拖动排序（写入 localStorage 的 group 顺序）────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const currentOrder = buckets.map((b) => b.key);
      const oldIdx = currentOrder.indexOf(String(active.id));
      const newIdx = currentOrder.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return;
      const next = arrayMove(currentOrder, oldIdx, newIdx);
      setGroupOrder(next);
      saveGroupOrder(next);
    },
    [buckets],
  );

  // ─── 渲染 ────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      {sessionsCollapsed ? (
        <div
          ref={collapsedRef}
          className="h-full flex flex-col items-center bg-[#f6f7f9] py-3 text-[14px] relative"
          onMouseEnter={openHoverList}
          onMouseLeave={closeHoverList}
        >
          <SideIconButton
            title="展开会话列表"
            onClick={toggleSessionsCollapsed}
          >
            <PanelLeftOpen size={18} />
          </SideIconButton>

          <div className="mt-2 flex flex-col items-center gap-1">
            <SideIconButton title="新会话" onClick={handleNewThread}>
              <SquarePen size={17} />
            </SideIconButton>
            <SideIconButton
              title="定时任务"
              active={activeLeftPanel === "cron"}
              onClick={() => setActiveLeftPanel("cron")}
            >
              <Clock size={17} />
            </SideIconButton>
            <SideIconButton
              title="技能"
              active={activeLeftPanel === "skills"}
              onClick={() => setActiveLeftPanel("skills")}
            >
              <Zap size={17} />
            </SideIconButton>
            <SideIconButton
              title="Agent Traces"
              active={activeLeftPanel === "traces"}
              onClick={() => setActiveLeftPanel("traces")}
            >
              <Activity size={17} />
            </SideIconButton>
          </div>

          <SideIconButton
            title="设置"
            active={activeLeftPanel === "settings"}
            className="mt-auto"
            onClick={handleOpenSettings}
          >
            <Settings size={17} />
          </SideIconButton>

          {/* 悬停浮层：会话列表 — portal 到 body 避免被父容器 overflow-hidden 裁剪 */}
          {hoverListOpen && createPortal(
            <div
              className="fixed z-50"
              style={{ top: overlayPos.top, left: overlayPos.left, height: overlayPos.height }}
              onMouseEnter={openHoverList}
              onMouseLeave={closeHoverList}
            >
              <div
                className="h-full overflow-hidden rounded-xl bg-[#f6f7f9] shadow-2xl border border-border/40 flex flex-col"
                style={{ width: sessionsWidth }}
              >
                {/* 顶层：新会话按钮 */}
                <div className="shrink-0 px-2 pt-3 pb-1">
                  <ExpandedNewThreadButton onClick={handleNewThread} />
                </div>
                {/* 段头 */}
                <div className="shrink-0 px-3 pb-1">
                  <span className="text-[12px] text-t-ghost font-medium">Ws Threads</span>
                </div>
                {/* 列表 */}
                <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
                  {totalCount === 0 ? (
                    <div className="text-t-ghost px-2 py-12 text-center text-[13px]">暂无会话</div>
                  ) : (
                    <>
                      {pinnedList.length > 0 && (
                        <div className="mb-4">
                          <div className="px-3 pb-1">
                            <span className="text-[12px] text-t-ghost font-medium flex items-center gap-1.5">
                              <Pin size={12} />
                              Pin Threads
                            </span>
                          </div>
                          <div className="space-y-px">
                            {pinnedList.map((session) => (
                              <SessionRow
                                key={session.session_id}
                                session={session}
                                alignWithSectionLabel
                                isActive={stripPrefix(session.session_id) === stripPrefix(currentSessionId || "")}
                                isHovered={hoveredSession === session.session_id}
                                isLoading={loadingSessionId === session.session_id}
                                isPinned
                                dotColor={getSessionColor(session.session_id)}
                                onDotClick={(e) => {
                                  e.stopPropagation();
                                  setColorPicker({ sessionId: session.session_id, x: e.clientX, y: e.clientY });
                                }}
                                onClick={() => handleSwitchSession(session.session_id)}
                                onEnter={() => setHoveredSession(session.session_id)}
                                onLeave={() => setHoveredSession(null)}
                                onMenu={(e) => showSessionMenu(e, session)}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {buckets.map((bucket) => {
                        const expanded = expandCount[bucket.key] ?? PER_GROUP_DEFAULT;
                        const paging = workspacePaging[bucket.full || ""];
                        const backendTotal = paging?.total ?? bucket.sessions.length;
                        const hasMoreInBackend = paging ? paging.loaded < paging.total : false;
                        return (
                          <WorkspaceGroup
                            key={bucket.key}
                            bucket={bucket}
                            first={false}
                            visibleCount={expanded}
                            hasMoreInBackend={hasMoreInBackend}
                            backendTotal={backendTotal}
                            currentSessionId={currentSessionId}
                            hoveredSession={hoveredSession}
                            loadingSessionId={loadingSessionId}
                            collapsed={collapsedWorkspaces.has(bucket.key)}
                            onSwitch={handleSwitchSession}
                            onHover={setHoveredSession}
                            onMenu={showSessionMenu}
                            onExpand={() => handleExpandGroup(bucket.key, bucket.full, bucket.sessions.length)}
                            onCollapse={() => handleCollapseGroup(bucket.key)}
                            onNewInWorkspace={() => handleNewInWorkspace(bucket.full)}
                            onToggleCollapse={() => handleToggleCollapse(bucket.key)}
                            onHeaderContextMenu={(e) => showWorkspaceHeaderMenu(e, bucket.full)}
                          />
                        );
                      })}
                      {otherSessions.length > 0 && (
                        <div className={buckets.length > 0 ? "mt-5" : ""}>
                          <div className="px-3 pb-1">
                            <span className="text-[12px] text-t-ghost font-medium">Other Threads</span>
                          </div>
                          <div className="space-y-px pl-[18px]">
                            {otherVisible.map((session) => (
                              <SessionRow
                                key={session.session_id}
                                session={session}
                                isActive={stripPrefix(session.session_id) === stripPrefix(currentSessionId || "")}
                                isHovered={hoveredSession === session.session_id}
                                isLoading={loadingSessionId === session.session_id}
                                isPinned={false}
                                onClick={() => handleSwitchSession(session.session_id)}
                                onEnter={() => setHoveredSession(session.session_id)}
                                onLeave={() => setHoveredSession(null)}
                                onMenu={(e) => showSessionMenu(e, session)}
                              />
                            ))}
                          </div>
                          {otherHidden > 0 && (
                            <div className="flex items-center gap-3 mt-1 pl-[30px] py-1 text-[12px]">
                              <button
                                type="button"
                                onClick={() => handleExpandGroup(OTHER_KEY, "", otherSessions.length)}
                                className="text-left text-t-ghost hover:text-neon transition-colors"
                              >
                                展开 +{Math.min(PER_GROUP_STEP, otherHidden)} 条
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
        </div>
      ) : (
      <div className="h-full flex flex-col bg-[#f6f7f9] text-[14px]">
        {/* ── 顶层动作区（New thread / Cron / Skills）── */}
        <div className="shrink-0 px-2 pt-3 pb-1">
          <div className="flex items-center gap-1">
            <ExpandedNewThreadButton onClick={handleNewThread} />
            <SideIconButton
              title="收起会话列表"
              className="shrink-0 w-10 h-10"
              onClick={toggleSessionsCollapsed}
            >
              <PanelLeftClose size={18} strokeWidth={1.8} />
            </SideIconButton>
          </div>
          <ActionRow
            icon={Clock}
            label="定时任务"
            active={activeLeftPanel === "cron"}
            onClick={() => setActiveLeftPanel("cron")}
          />
          <ActionRow
            icon={Zap}
            label="技能"
            active={activeLeftPanel === "skills"}
            onClick={() => setActiveLeftPanel("skills")}
          />
          <ActionRow
            icon={Activity}
            label="追踪"
            active={activeLeftPanel === "traces"}
            onClick={() => setActiveLeftPanel("traces")}
          />
        </div>

        {/* ── Ws Threads 段头 ── */}
        <div className="shrink-0 px-3 pb-1">
          <span className="text-[12px] text-t-ghost font-medium">
            Ws Threads
          </span>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
          {totalCount === 0 ? (
            <div className="text-t-ghost px-2 py-12 text-center text-[13px]">
              暂无会话
            </div>
          ) : (
            <>
              {/* Pin Threads：所有置顶会话，与 Ws Threads 平级 */}
              {pinnedList.length > 0 && (
                <div className="mb-4">
                  <div className="px-3 pb-1">
                    <span className="text-[12px] text-t-ghost font-medium flex items-center gap-1.5">
                      <Pin size={12} />
                      Pin Threads
                    </span>
                  </div>
                  <div className="space-y-px">
                    {pinnedList.map((session) => (
                      <SessionRow
                        key={session.session_id}
                        session={session}
                        alignWithSectionLabel
                        isActive={
                          stripPrefix(session.session_id) ===
                          stripPrefix(currentSessionId || "")
                        }
                        isHovered={hoveredSession === session.session_id}
                        isLoading={loadingSessionId === session.session_id}
                        isPinned
                        dotColor={getSessionColor(session.session_id)}
                        onDotClick={(e) => {
                          e.stopPropagation();
                          setColorPicker({
                            sessionId: session.session_id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        onClick={() => handleSwitchSession(session.session_id)}
                        onEnter={() => setHoveredSession(session.session_id)}
                        onLeave={() => setHoveredSession(null)}
                        onMenu={(e) => showSessionMenu(e, session)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Ws Threads：按 workspace 分组 */}
              {buckets.length > 0 && (() => {
                const MAX_GROUPS = 5;
                const visibleBuckets = showAllGroups ? buckets : buckets.slice(0, MAX_GROUPS);
                const hiddenCount = buckets.length - visibleBuckets.length;
                return (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={visibleBuckets.map((b) => b.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    {visibleBuckets.map((bucket, idx) => {
                      const expanded = expandCount[bucket.key] ?? PER_GROUP_DEFAULT;
                      const paging = workspacePaging[bucket.full || ""];
                      const backendTotal = paging?.total ?? bucket.sessions.length;
                      const hasMoreInBackend = paging
                        ? paging.loaded < paging.total
                        : false;
                      return (
                        <WorkspaceGroup
                          key={bucket.key}
                          bucket={bucket}
                          first={idx === 0}
                          visibleCount={expanded}
                          hasMoreInBackend={hasMoreInBackend}
                          backendTotal={backendTotal}
                          currentSessionId={currentSessionId}
                          hoveredSession={hoveredSession}
                          loadingSessionId={loadingSessionId}
                          collapsed={collapsedWorkspaces.has(bucket.key)}
                          onSwitch={handleSwitchSession}
                          onHover={setHoveredSession}
                          onMenu={showSessionMenu}
                          onExpand={() => handleExpandGroup(bucket.key, bucket.full, bucket.sessions.length)}
                          onCollapse={() => handleCollapseGroup(bucket.key)}
                          onNewInWorkspace={() => handleNewInWorkspace(bucket.full)}
                          onToggleCollapse={() => handleToggleCollapse(bucket.key)}
                          onHeaderContextMenu={(e) => showWorkspaceHeaderMenu(e, bucket.full)}
                        />
                      );
                    })}
                  </SortableContext>
                  {(hiddenCount > 0 || showAllGroups) && (
                    <div className="flex items-center gap-3 mt-2 pl-[30px] py-1 text-[12px]">
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAllGroups(true)}
                          className="text-left text-t-ghost hover:text-neon transition-colors"
                        >
                          展开更多工作区 (+{hiddenCount})
                        </button>
                      )}
                      {showAllGroups && buckets.length > MAX_GROUPS && (
                        <button
                          type="button"
                          onClick={() => setShowAllGroups(false)}
                          className="text-left text-t-ghost hover:text-neon transition-colors"
                        >
                          收起
                        </button>
                      )}
                    </div>
                  )}
                </DndContext>
                );
              })()}

              {/* Other Threads：非 ws channel，平铺 */}
              {otherSessions.length > 0 && (
                <div className={buckets.length > 0 ? "mt-5" : ""}>
                  <div className="px-3 pb-1">
                    <span className="text-[12px] text-t-ghost font-medium">
                      Other Threads
                    </span>
                  </div>
                  <div className="space-y-px pl-[18px]">
                    {otherVisible.map((session) => (
                      <SessionRow
                        key={session.session_id}
                        session={session}
                        isActive={
                          stripPrefix(session.session_id) ===
                          stripPrefix(currentSessionId || "")
                        }
                        isHovered={hoveredSession === session.session_id}
                        isLoading={loadingSessionId === session.session_id}
                        isPinned={false}
                        onClick={() => handleSwitchSession(session.session_id)}
                        onEnter={() => setHoveredSession(session.session_id)}
                        onLeave={() => setHoveredSession(null)}
                        onMenu={(e) => showSessionMenu(e, session)}
                      />
                    ))}
                  </div>
                  {(otherHidden > 0 || otherIsExpanded) && (
                    <div className="flex items-center gap-3 mt-1 pl-[30px] py-1 text-[12px]">
                      {otherHidden > 0 && (
                        <button
                          type="button"
                          onClick={() => handleExpandGroup(OTHER_KEY, "", otherSessions.length)}
                          className="text-left text-t-ghost hover:text-neon transition-colors"
                        >
                          展开 +{Math.min(PER_GROUP_STEP, otherHidden)} 条
                        </button>
                      )}
                      {otherIsExpanded && (
                        <button
                          type="button"
                          onClick={() => handleCollapseGroup(OTHER_KEY)}
                          className="text-left text-t-ghost hover:text-neon transition-colors"
                        >
                          收起
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 工作区分组已各自分页（每组"展开 +N"按需拉取），不再需要全局加载更多 */}
        </div>

        {/* ── 底部动作区（设置）── */}
        <div className="shrink-0 px-2 py-2">
          <ActionRow
            icon={Settings}
            label="设置"
            active={activeLeftPanel === "settings"}
            onClick={handleOpenSettings}
          />
        </div>

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            position={contextMenu.position}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* 重命名对话框 */}
        {renamingSession && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setRenamingSession(null)}
          >
            <div
              className="bg-surface rounded-lg border border-border shadow-xl w-[320px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-border">
                <span className="text-[13px] text-t-primary font-medium">
                  重命名会话
                </span>
              </div>
              <div className="p-4">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleRenameSession(renamingSession.session_id, renameValue);
                    } else if (e.key === "Escape") {
                      setRenamingSession(null);
                    }
                  }}
                  className="w-full h-8 px-3 rounded bg-base border border-border focus:border-neon/50 text-[12px] text-t-primary outline-none"
                  placeholder="输入新标题"
                  autoFocus
                />
              </div>
              <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setRenamingSession(null)}
                  className="px-3 py-1.5 rounded text-[12px] text-t-muted hover:bg-hover"
                >
                  取消
                </button>
                <button
                  onClick={() =>
                    handleRenameSession(renamingSession.session_id, renameValue)
                  }
                  className="px-3 py-1.5 rounded text-[12px] bg-neon/20 text-neon hover:bg-neon/30"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* 颜色选择器 Popover */}
      {colorPicker && (
        <div
          className="fixed inset-0 z-[200]"
          onClick={() => setColorPicker(null)}
        >
          <div
            className="absolute bg-elevated border border-border-subtle rounded-xl shadow-2xl p-3 flex flex-wrap gap-2 w-[180px] animate-in fade-in zoom-in-95 duration-150"
            style={{
              left: Math.min(colorPicker.x, window.innerWidth - 200),
              top: Math.min(colorPicker.y + 8, window.innerHeight - 200),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {DOT_PALETTE.map((color) => (
              <button
                key={color}
                className="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110 active:scale-90"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.25)`,
                }}
                onClick={() => handleSetSessionColor(colorPicker.sessionId, color)}
              />
            ))}
            {/* 禁用 / 清除色点 */}
            <button
              title="取消色点"
              aria-label="取消色点"
              className="relative w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110 active:scale-90 bg-white/95 dark:bg-white/90 border border-black/10"
              onClick={() => handleSetSessionColor(colorPicker.sessionId, null)}
            >
              <svg
                viewBox="0 0 24 24"
                className="pointer-events-none absolute inset-0 m-auto w-5 h-5 text-black/55"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="9" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

    </TooltipProvider>
  );
}

// ─── 单个工作区分组（点击=折叠/展开，拖动=排序）──────────────────

interface WorkspaceGroupProps {
  bucket: WorkspaceBucket;
  first: boolean;
  visibleCount: number;
  /** 后端该工作区是否还有未加载的会话（决定"展开"按钮是否显示） */
  hasMoreInBackend: boolean;
  /** 后端该工作区的总会话数（用于"展开 +N"的计数显示） */
  backendTotal: number;
  currentSessionId: string | null;
  hoveredSession: string | null;
  loadingSessionId: string | null;
  /** 是否折叠（会话列表隐藏） */
  collapsed: boolean;
  onSwitch: (sessionId: string) => void;
  onHover: (sessionId: string | null) => void;
  onMenu: (e: React.MouseEvent, session: SessionSummary) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onNewInWorkspace: () => void;
  onToggleCollapse: () => void;
  /** 工作区 header 右键菜单 */
  onHeaderContextMenu: (e: React.MouseEvent) => void;
}

function WorkspaceGroup({
  bucket,
  first,
  visibleCount,
  hasMoreInBackend,
  backendTotal,
  currentSessionId,
  hoveredSession,
  loadingSessionId,
  collapsed,
  onSwitch,
  onHover,
  onMenu,
  onExpand,
  onCollapse,
  onNewInWorkspace,
  onToggleCollapse,
  onHeaderContextMenu,
}: WorkspaceGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: bucket.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const visibleSessions = bucket.sessions.slice(0, visibleCount);
  const hiddenInGroup = bucket.sessions.length - visibleSessions.length;
  const expanded = visibleCount > PER_GROUP_DEFAULT;
  const accent = folderColor(bucket.key);
  // 还能展开：内存里有隐藏的，或后端还有没拉下来的
  const canExpand = hiddenInGroup > 0 || hasMoreInBackend;

  return (
    <div ref={setNodeRef} style={style} className={first ? "" : "mt-4"}>
      {/* 工作区标题：
          - 单击 → 折叠/展开会话列表
          - "+" 按钮 → 在此工作区新建会话
          - 右键 → 工作区操作菜单
          - 拖动（≥5px）→ 重排
          - dnd-kit 的 PointerSensor distance=5 已经在区分单击和拖动 */}
        <div
          {...attributes}
          {...listeners}
          onClick={onToggleCollapse}
          onContextMenu={onHeaderContextMenu}
          className={`group flex items-center gap-2 px-2 py-1 min-w-0 transition-colors select-none rounded
            cursor-pointer hover:bg-hover
            ${bucket.isActive ? "text-t-secondary" : "text-t-muted hover:text-t-secondary"}
          `}
        >
          {/* 文件夹图标：展开时显示打开，折叠时显示关闭 */}
          {!collapsed ? (
            <FolderOpen size={15} className="shrink-0" strokeWidth={1.8} style={{ color: accent, opacity: bucket.isActive ? 1 : 0.85 }} />
          ) : (
            <Folder size={15} className="shrink-0" strokeWidth={1.8} style={{ color: accent, opacity: bucket.isActive ? 1 : 0.85 }} />
          )}
          <span
            className="text-[14px] truncate flex-1 font-medium"
          >
            {bucket.name}
          </span>
          <span className="text-[12px] text-t-ghost shrink-0 group-hover:hidden">
            {backendTotal || bucket.sessions.length}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNewInWorkspace();
            }}
            className="hidden group-hover:flex shrink-0 w-6 h-6 items-center justify-center rounded-full hover:bg-active text-t-ghost hover:text-t-primary transition-colors"
            title="在此工作区新建会话"
          >
            <Plus size={15} strokeWidth={2} />
          </button>
        </div>

      {/* 会话列表（左缩进对齐工作区名） */}
      {!collapsed && (
        <div className="mt-0.5 space-y-px">
          {visibleSessions.map((session) => (
            <SessionRow
              key={session.session_id}
              session={session}
              alignWithSectionLabel
              isActive={
                stripPrefix(session.session_id) ===
                stripPrefix(currentSessionId || "")
              }
              isHovered={hoveredSession === session.session_id}
              isLoading={loadingSessionId === session.session_id}
              isPinned={false}
              onClick={() => onSwitch(session.session_id)}
              onEnter={() => onHover(session.session_id)}
              onLeave={() => onHover(null)}
              onMenu={(e) => onMenu(e, session)}
            />
          ))}
        </div>
      )}

      {/* 展开 / 收起：可以同时存在（已展开但还有更多） */}
      {!collapsed && (canExpand || expanded) && (
        <div className="flex items-center gap-3 mt-1 pl-[30px] py-1 text-[12px]">
          {canExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="text-left text-t-ghost hover:text-neon transition-colors"
            >
              展开 +{PER_GROUP_STEP} 条
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={onCollapse}
              className="text-left text-t-ghost hover:text-neon transition-colors"
            >
              收起
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function stripPrefix(id: string): string {
  return id.includes(":") ? id.substring(id.indexOf(":") + 1) : id;
}

// ─── 顶/底动作行 ────────────────────────────────────────────────

interface ActionRowProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function ActionRow({ icon: Icon, label, active, onClick }: ActionRowProps) {
  const { ripples, trigger, remove } = useRipple();
  return (
    <button
      type="button"
      onClick={(e) => {
        trigger(e);
        onClick();
      }}
      className={`relative overflow-hidden w-full flex items-center gap-2.5 px-3 py-1.5 rounded-full transition-colors text-left
        ${active
          ? "bg-active text-t-primary font-medium"
          : "text-t-secondary hover:text-t-primary hover:bg-hover"}
      `}
    >
      <RippleLayer items={ripples} onEnd={remove} />
      <Icon size={16} strokeWidth={1.7} className="relative shrink-0" />
      <span className="relative text-[14px] truncate">{label}</span>
    </button>
  );
}

// ─── 侧边图标按钮（折叠态 / 收起按钮，带水波纹） ──────────────────

interface SideIconButtonProps {
  title: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function SideIconButton({
  title,
  active,
  className,
  onClick,
  children,
}: SideIconButtonProps) {
  const { ripples, trigger, remove } = useRipple();
  return (
    <button
      type="button"
      onClick={(e) => {
        trigger(e);
        onClick();
      }}
      title={title}
      aria-label={title}
      className={`relative overflow-hidden flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
        active
          ? "bg-active text-t-primary"
          : "text-t-muted hover:text-t-primary hover:bg-hover"
      } ${className ?? ""}`}
    >
      <RippleLayer items={ripples} onEnd={remove} />
      <span className="relative">{children}</span>
    </button>
  );
}

// ─── 展开态「新会话」按钮（带水波纹） ──────────────────────────────

function ExpandedNewThreadButton({ onClick }: { onClick: () => void }) {
  const { ripples, trigger, remove } = useRipple();
  return (
    <button
      type="button"
      onClick={(e) => {
        trigger(e);
        onClick();
      }}
      className="relative overflow-hidden flex-1 flex items-center gap-2 h-10 px-3 rounded-full text-t-muted hover:text-t-primary hover:bg-hover transition-colors min-w-0"
      title="新会话"
    >
      <RippleLayer items={ripples} onEnd={remove} />
      <SquarePen size={16} strokeWidth={1.7} className="relative shrink-0" />
      <span className="relative text-[14px] truncate">新会话</span>
    </button>
  );
}

// ─── 单条会话行 ───────────────────────────────────────────────────

interface SessionRowProps {
  session: SessionSummary;
  isActive: boolean;
  isHovered: boolean;
  isLoading: boolean;
  isPinned: boolean;
  alignWithSectionLabel?: boolean;
  dotColor?: string;
  onDotClick?: (e: React.MouseEvent) => void;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onMenu: (e: React.MouseEvent) => void;
}

function SessionRow({
  session,
  isActive,
  isHovered,
  isLoading,
  isPinned,
  alignWithSectionLabel = false,
  dotColor,
  onDotClick,
  onClick,
  onEnter,
  onLeave,
  onMenu,
}: SessionRowProps) {
  const time = timeAgo(session.updated_at ?? 0);
  const suffix = channelSuffix(session.channel);

  const { ripples, trigger, remove } = useRipple();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      trigger(e);
      onClick();
    },
    [trigger, onClick],
  );

  return (
    <div
      onClick={handleClick}
      onContextMenu={onMenu}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`relative overflow-hidden flex items-center gap-2 h-10 pr-3 rounded-full cursor-pointer select-none transition-colors ${alignWithSectionLabel ? "pl-[45px]" : "pl-3"} ${isActive
        ? "bg-[#e7e7e8] hover:bg-[#e7e7e8]"
        : "hover:bg-hover"
        }`}
    >
      <RippleLayer items={ripples} onEnd={remove} />
      {/* 置顶色点：绝对定位，不占 flex 空间，保持文字左对齐 */}
      {isPinned && dotColor && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDotClick?.(e); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-90 hover:opacity-100 hover:scale-110 active:scale-95 transition-transform cursor-pointer"
          style={{ backgroundColor: dotColor, boxShadow: `0 1px 3px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)` }}
          title="点击更换颜色"
        />
      )}
      <span
        className={`flex-1 truncate text-[13.5px] ${isActive ? "text-black font-normal" : "text-t-secondary"
          }`}
      >
        {session.title || "新会话"}
        {suffix && (
          <span className="ml-1.5 text-[11.5px] text-t-ghost font-mono">
            ({suffix})
          </span>
        )}
      </span>

      {/* 右侧：时间 / 运行中 spinner / 菜单按钮叠加，hover 切透明度 */}
      <div className="relative shrink-0 w-7 h-5 flex items-center justify-end">
        {isLoading && (
          <Loader2
            size={12}
            className="absolute right-0 text-t-ghost animate-spin"
          />
        )}
        {!isLoading && session.running && (
          <Loader2
            size={12}
            className="absolute right-0 text-t-ghost animate-spin"
          />
        )}
        <span
          className="absolute right-0 text-[12px] tabular-nums transition-opacity"
          style={{
            opacity: (isHovered || isLoading || session.running) ? 0 : time.opacity,
            color: "var(--color-t-dim)",
            pointerEvents: "none",
          }}
        >
          {time.text}
        </span>
        <button
          onClick={onMenu}
          aria-label="更多"
          className={`absolute right-0 p-1 rounded-full text-t-dim hover:text-t-primary hover:bg-hover transition-opacity ${isHovered && !isLoading && !session.running ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  );
}
