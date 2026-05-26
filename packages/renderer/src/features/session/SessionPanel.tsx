/**
 * SessionPanel — 会话列表（侧边栏，工作区分组 + 拖动排序）
 *
 * 视觉：
 *   - 工作区作为不可折叠的标题行（📁 + basename），可拖动整组重排
 *   - 每组默认显示 5 条；点"展开 +N 条"调 store.loadMoreSessions(10)
 *   - 活跃会话左侧 accent 圆点 + 行底胶囊高亮
 *   - 时间右对齐，hover 时被『更多』按钮通过透明度切换覆盖（不重排）
 *   - 非 ws 通道用 (cron) 等小后缀
 *
 * 排序：
 *   - 默认按"组内最新一条 updated_at"倒序，活跃工作区自动冒顶
 *   - 用户手动拖动后，顺序记到 localStorage（按 workspaceKey）
 *   - 一旦有自定义顺序：已知组按用户顺序，新组按默认规则排在尾部
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
import {
  Plus,
  MoreHorizontal,
  Search,
  Loader2,
  Archive,
  Pencil,
  Copy,
  Folder,
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
import { useNotification } from "@/stores/notification";
import { triggerCompaction, updateSession } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import type { SessionSummary } from "@/services/api";

// ─── 工具 ──────────────────────────────────────────────────────────

function timeAgo(ts: number): { text: string; opacity: number } {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return { text: "now", opacity: 1 };
  if (diff < 3600) return { text: `${Math.floor(diff / 60)}m`, opacity: 0.9 };
  if (diff < 86400) return { text: `${Math.floor(diff / 3600)}h`, opacity: 0.7 };
  if (diff < 604800) return { text: `${Math.floor(diff / 86400)}d`, opacity: 0.5 };
  return { text: `${Math.floor(diff / 604800)}w`, opacity: 0.4 };
}

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
  if (!ws) return "__none__";
  return ws.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

const NONE_KEY = "__none__";

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

// ─── 拖动排序持久化 ────────────────────────────────────────────────

const ORDER_STORAGE_KEY = "ftre-session-workspace-order";

function loadGroupOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveGroupOrder(order: string[]): void {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
}

// ─── 类型 ──────────────────────────────────────────────────────────

interface WorkspaceBucket {
  key: string;
  name: string;
  full: string;
  sessions: SessionSummary[];
  /** 组内最新 updated_at，用于默认排序 */
  latestAt: number;
}

const PER_GROUP_DEFAULT = 5;
const PER_GROUP_STEP = 10;

// ─── 主组件 ────────────────────────────────────────────────────────

export function SessionPanel() {
  const allSessions = useSession((s) => s.allSessions);
  const sessionsTotal = useSession((s) => s.sessionsTotal);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const loadMoreSessions = useSession((s) => s.loadMoreSessions);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const newSession = useSession((s) => s.newSession);
  const loadingSessionId = useSession((s) => s.loadingSessionId);
  const currentSessionId = useChat((s) => s.sessionId);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  /** 每个 group 已展开多少条；未列入即 PER_GROUP_DEFAULT */
  const [expandCount, setExpandCount] = useState<Record<string, number>>({});
  /** 用户手动拖动后的 group 顺序；空数组表示走默认排序 */
  const [groupOrder, setGroupOrder] = useState<string[]>(() => loadGroupOrder());
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [renamingSession, setRenamingSession] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // 搜索过滤
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allSessions;
    return allSessions.filter((s) => (s.title || "").toLowerCase().includes(q));
  }, [allSessions, searchQuery]);

  // 按工作区分组
  const buckets = useMemo<WorkspaceBucket[]>(() => {
    const map = new Map<string, WorkspaceBucket>();
    for (const s of filtered) {
      const key = workspaceKey(s.workspace);
      let g = map.get(key);
      if (!g) {
        const { name, full } = workspaceLabel(s.workspace);
        g = { key, name, full, sessions: [], latestAt: 0 };
        map.set(key, g);
      }
      g.sessions.push(s);
      const ts = s.updated_at ?? 0;
      if (ts > g.latestAt) g.latestAt = ts;
    }
    for (const g of map.values()) {
      g.sessions.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    }

    const all = [...map.values()];
    if (groupOrder.length === 0) {
      // 默认：按 latestAt 倒序，"未设置工作区"压底
      return all.sort((a, b) => {
        if (a.key === NONE_KEY && b.key !== NONE_KEY) return 1;
        if (b.key === NONE_KEY && a.key !== NONE_KEY) return -1;
        return b.latestAt - a.latestAt;
      });
    }
    // 自定义顺序：已知组按 groupOrder 排，未在序列里的新组按默认规则追加到尾部
    const orderIdx = new Map<string, number>();
    groupOrder.forEach((k, i) => orderIdx.set(k, i));
    const known: WorkspaceBucket[] = [];
    const unknown: WorkspaceBucket[] = [];
    for (const g of all) {
      if (orderIdx.has(g.key)) known.push(g);
      else unknown.push(g);
    }
    known.sort((a, b) => orderIdx.get(a.key)! - orderIdx.get(b.key)!);
    unknown.sort((a, b) => {
      if (a.key === NONE_KEY && b.key !== NONE_KEY) return 1;
      if (b.key === NONE_KEY && a.key !== NONE_KEY) return -1;
      return b.latestAt - a.latestAt;
    });
    return [...known, ...unknown];
  }, [filtered, groupOrder]);

  const totalCount = filtered.length;
  const hasMore = sessionsTotal > 0 && allSessions.length < sessionsTotal;

  // ─── 操作 ────────────────────────────────────────────────────────

  const handleSwitchSession = useCallback(
    (sessionId: string) => switchSession(sessionId),
    [switchSession],
  );

  const handleCompaction = useCallback(async (sessionId: string) => {
    const result = await triggerCompaction(sessionId);
    useNotification.getState().addNotification({
      level: result ? "info" : "error",
      message: result ? "归档任务已触发" : "归档任务触发失败",
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
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "copy-session-id",
            label: "复制 Session ID",
            icon: Copy,
            action: () => navigator.clipboard.writeText(session.session_id),
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
          {
            id: "compact-session",
            label: "归档会话",
            icon: Archive,
            action: () => handleCompaction(session.session_id),
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
    [deleteSession, handleCompaction],
  );

  const handleSearchToggle = useCallback(() => {
    setSearchOpen((prev) => {
      if (!prev) setTimeout(() => searchInputRef.current?.focus(), 0);
      else setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleExpandGroup = useCallback(async (key: string, groupTotal: number) => {
    // 当前展开数；未记录则视作默认 5
    const current = expandCount[key] ?? PER_GROUP_DEFAULT;
    const next = Math.min(current + PER_GROUP_STEP, groupTotal);
    setExpandCount((prev) => ({ ...prev, [key]: next }));

    // 如果加载量已经接近后端总数还满足不了，触发后端拉更多
    if (
      sessionsTotal > 0 &&
      allSessions.length < sessionsTotal &&
      groupTotal < next
    ) {
      setLoadingMore(true);
      try {
        await loadMoreSessions(PER_GROUP_STEP);
      } finally {
        setLoadingMore(false);
      }
    }
  }, [expandCount, sessionsTotal, allSessions.length, loadMoreSessions]);

  const handleCollapseGroup = useCallback((key: string) => {
    setExpandCount((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleLoadMoreGlobal = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      await loadMoreSessions(PER_GROUP_STEP);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadMoreSessions]);

  // ─── 拖动排序 ────────────────────────────────────────────────────

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
      <div className="h-full flex flex-col bg-surface text-[13px]">
        {/* Header */}
        <div className="shrink-0 px-3 py-3 flex items-center justify-between">
          <span className="text-[13px] text-t-primary font-medium">会话</span>
          <Tooltip content="搜索会话" side="bottom">
            <button
              onClick={handleSearchToggle}
              className={`flex items-center justify-center h-7 w-7 rounded transition-colors ${searchOpen
                ? "text-neon bg-neon/10"
                : "text-t-ghost hover:text-t-primary hover:bg-hover"
                }`}
            >
              <Search size={14} />
            </button>
          </Tooltip>
        </div>

        {/* 搜索框 */}
        {searchOpen && (
          <div className="shrink-0 px-3 pb-2">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话..."
              className="w-full h-8 px-3 rounded bg-elevated border border-border/50 focus:border-neon/50 text-[12px] text-t-primary placeholder:text-t-ghost outline-none transition-colors"
            />
          </div>
        )}

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
          {totalCount === 0 ? (
            <div className="text-t-ghost px-2 py-12 text-center text-[12px]">
              {searchQuery ? "没有匹配的会话" : "暂无会话"}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={buckets.map((b) => b.key)}
                strategy={verticalListSortingStrategy}
              >
                {buckets.map((bucket, idx) => {
                  const expanded = expandCount[bucket.key] ?? PER_GROUP_DEFAULT;
                  return (
                    <WorkspaceGroup
                      key={bucket.key}
                      bucket={bucket}
                      first={idx === 0}
                      visibleCount={expanded}
                      currentSessionId={currentSessionId}
                      hoveredSession={hoveredSession}
                      loadingSessionId={loadingSessionId}
                      onSwitch={handleSwitchSession}
                      onHover={setHoveredSession}
                      onMenu={showSessionMenu}
                      onExpand={() => handleExpandGroup(bucket.key, bucket.sessions.length)}
                      onCollapse={() => handleCollapseGroup(bucket.key)}
                      onNew={() => newSession(bucket.full || undefined)}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}

          {/* 全局"加载更多"：当所有组都展示完已加载会话、但后端还有未拉取时 */}
          {hasMore && !searchQuery && (
            <button
              type="button"
              onClick={handleLoadMoreGlobal}
              disabled={loadingMore}
              className="w-full mt-3 py-2 text-[11.5px] text-t-ghost hover:text-neon transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loadingMore ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  加载中...
                </>
              ) : (
                <>从服务器拉更多（剩 {sessionsTotal - allSessions.length}）</>
              )}
            </button>
          )}
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
    </TooltipProvider>
  );
}

// ─── 单个工作区分组（可拖动） ─────────────────────────────────────

interface WorkspaceGroupProps {
  bucket: WorkspaceBucket;
  first: boolean;
  visibleCount: number;
  currentSessionId: string | null;
  hoveredSession: string | null;
  loadingSessionId: string | null;
  onSwitch: (sessionId: string) => void;
  onHover: (sessionId: string | null) => void;
  onMenu: (e: React.MouseEvent, session: SessionSummary) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onNew: () => void;
}

function WorkspaceGroup({
  bucket,
  first,
  visibleCount,
  currentSessionId,
  hoveredSession,
  loadingSessionId,
  onSwitch,
  onHover,
  onMenu,
  onExpand,
  onCollapse,
  onNew,
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

  return (
    <div ref={setNodeRef} style={style} className={first ? "" : "mt-4"}>
      {/* 工作区标题：整行就是拖动 handle，按住任何位置都能拖；
          右侧 hover 时露出 + 按钮，新建会话会落到这个工作区下 */}
      <div className="group flex items-center">
        <Tooltip content={bucket.full || "未设置工作区"} side="bottom">
          <div
            {...attributes}
            {...listeners}
            className="flex items-center gap-2 px-2 py-1 flex-1 min-w-0 text-t-secondary cursor-grab active:cursor-grabbing hover:text-t-primary transition-colors select-none"
          >
            <Folder size={14} className="opacity-80 shrink-0" strokeWidth={1.8} />
            <span className="text-[14px] font-medium truncate flex-1">
              {bucket.name}
            </span>
            <span className="text-[11px] text-t-ghost shrink-0 group-hover:hidden">
              {bucket.sessions.length}
            </span>
          </div>
        </Tooltip>
        <Tooltip content="在此工作区新建会话" side="bottom">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onNew();
            }}
            aria-label="新建会话"
            className="shrink-0 ml-0.5 mr-1 h-6 w-6 flex items-center justify-center rounded text-t-ghost opacity-0 group-hover:opacity-100 hover:text-neon hover:bg-hover transition-opacity"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

      {/* 会话列表（左缩进对齐文件夹名） */}
      <div className="mt-0.5 space-y-px pl-3">
        {visibleSessions.map((session) => (
          <SessionRow
            key={session.session_id}
            session={session}
            isActive={
              stripPrefix(session.session_id) ===
              stripPrefix(currentSessionId || "")
            }
            isHovered={hoveredSession === session.session_id}
            isLoading={loadingSessionId === session.session_id}
            onClick={() => onSwitch(session.session_id)}
            onEnter={() => onHover(session.session_id)}
            onLeave={() => onHover(null)}
            onMenu={(e) => onMenu(e, session)}
          />
        ))}
      </div>

      {/* 展开 / 收起 */}
      {(hiddenInGroup > 0 || expanded) && (
        <button
          type="button"
          onClick={hiddenInGroup > 0 ? onExpand : onCollapse}
          className="w-full mt-1 pl-6 py-1 text-left text-[11px] text-t-ghost hover:text-neon transition-colors"
        >
          {hiddenInGroup > 0
            ? `展开 +${Math.min(PER_GROUP_STEP, hiddenInGroup)} 条`
            : "收起"}
        </button>
      )}
    </div>
  );
}

function stripPrefix(id: string): string {
  return id.includes(":") ? id.substring(id.indexOf(":") + 1) : id;
}

// ─── 单条会话行 ───────────────────────────────────────────────────

interface SessionRowProps {
  session: SessionSummary;
  isActive: boolean;
  isHovered: boolean;
  isLoading: boolean;
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
  onClick,
  onEnter,
  onLeave,
  onMenu,
}: SessionRowProps) {
  const time = timeAgo(session.updated_at ?? 0);
  const suffix = channelSuffix(session.channel);

  return (
    <div
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`flex items-center gap-2 h-9 px-3 rounded-full cursor-pointer select-none transition-colors ${isActive
        ? "bg-neon/10 hover:bg-neon/15"
        : "hover:bg-hover"
        }`}
    >
      <span
        className={`flex-1 truncate text-[12.5px] ${isActive ? "text-neon" : "text-t-secondary"
          }`}
      >
        {session.title || "新会话"}
        {suffix && (
          <span className="ml-1.5 text-[10.5px] text-t-ghost font-mono">
            ({suffix})
          </span>
        )}
      </span>

      {/* 右侧：时间 / 菜单按钮叠加，hover 切透明度，避免 DOM 替换抖动 */}
      <div className="relative shrink-0 w-7 h-5 flex items-center justify-end">
        {isLoading && (
          <Loader2
            size={11}
            className="absolute right-0 text-t-ghost animate-spin"
          />
        )}
        <span
          className="absolute right-0 text-[11px] tabular-nums transition-opacity"
          style={{
            opacity: isHovered || isLoading ? 0 : time.opacity,
            color: "var(--color-t-dim)",
            pointerEvents: "none",
          }}
        >
          {time.text}
        </span>
        <button
          onClick={onMenu}
          aria-label="更多"
          className={`absolute right-0 p-1 rounded text-t-dim hover:text-t-primary hover:bg-hover transition-opacity ${isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}
