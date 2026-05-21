import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Plus,
  MoreHorizontal,
  Search,
  Loader2,
  RefreshCw,
  Archive,
  Pencil,
  Copy,
  FolderOpen,
  Check,
  ChevronsUpDown,
  Filter,
  Globe,
  Bot,
  Terminal,
  MessageCircle,
  HelpCircle,
} from "lucide-react";
import { useSession } from "@/stores/session";
import { useChat } from "@/stores/chat";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import { triggerCompaction, updateSession } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { SessionSummary } from "@/services/api";
import { normalizePathForCompare } from "@/utils/pathUtils";

// ─── 工具函数 ──────────────────────────────────────────────────────

function timeAgo(ts: number): { text: string; opacity: number } {
  const diff = Date.now() / 1000 - ts;
  let text: string;
  let opacity: number;

  if (diff < 60) {
    text = "now";
    opacity = 1;
  } else if (diff < 3600) {
    text = `${Math.floor(diff / 60)}m`;
    opacity = 0.9;
  } else if (diff < 86400) {
    text = `${Math.floor(diff / 3600)}h`;
    opacity = 0.7;
  } else if (diff < 604800) {
    text = `${Math.floor(diff / 86400)}d`;
    opacity = 0.5;
  } else {
    text = `${Math.floor(diff / 604800)}w`;
    opacity = 0.4;
  }

  return { text, opacity };
}

function folderName(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || fullPath;
}

type SessionTimeBucketKey =
  | "running"
  | "just_now"
  | "today"
  | "yesterday"
  | "long_ago";

const SESSION_TIME_BUCKETS: Array<{
  key: SessionTimeBucketKey;
  label: string;
}> = [
  { key: "running", label: "运行中" },
  { key: "just_now", label: "刚刚" },
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "long_ago", label: "很久之前" },
];

function getSessionTimeBucket(
  updatedAt: number,
  isRunning: boolean,
): SessionTimeBucketKey {
  if (isRunning) return "running";
  const nowSec = Date.now() / 1000;
  if (nowSec - updatedAt <= 300) return "just_now";

  const now = new Date();
  const todayStartSec =
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const yesterdayStartSec = todayStartSec - 86400;

  if (updatedAt >= todayStartSec) return "today";
  if (updatedAt >= yesterdayStartSec) return "yesterday";
  return "long_ago";
}

// ─── 类型定义 ──────────────────────────────────────────────────────

type SourceType = string;

interface SourceGroup {
  source: SourceType;
  label: string;
  sessions: SessionSummary[];
}

interface WorkspaceGroup {
  displayPath: string;
  normalizedPath: string;
  sourceGroups: SourceGroup[];
  totalCount: number;
}

const SOURCE_LABELS: Record<string, string> = {
  user: "User",
  email: "Email",
  system: "System",
};

const SOURCE_ORDER = ["user", "email", "system"];

function getSourceLabel(source: string): string {
  return (
    SOURCE_LABELS[source] || source.charAt(0).toUpperCase() + source.slice(1)
  );
}

// Channel 标签和图标映射
const CHANNEL_LABELS: Record<string, string> = {
  websocket: "Web",
  dmwork: "DMWork",
  cli: "CLI",
  telegram: "Telegram",
  unknown: "未知",
};

const CHANNEL_ICONS: Record<string, typeof Globe> = {
  websocket: Globe,
  dmwork: Bot,
  cli: Terminal,
  telegram: MessageCircle,
  unknown: HelpCircle,
};

function getChannelLabel(channel?: string): string {
  return CHANNEL_LABELS[channel || "unknown"] || channel || "未知";
}

function getChannelIcon(channel?: string): typeof Globe {
  return CHANNEL_ICONS[channel || "unknown"] || HelpCircle;
}

function buildWorkspaceGroup(
  normalizedPath: string,
  displayPath: string,
  sessions: SessionSummary[],
): WorkspaceGroup {
  const bySource = new Map<string, SessionSummary[]>();
  sessions.forEach((s) => {
    const src = s.source || "user";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src)!.push(s);
  });

  const sourceGroups: SourceGroup[] = [];
  const knownSources = SOURCE_ORDER.filter((s) => bySource.has(s));
  const unknownSources = [...bySource.keys()]
    .filter((s) => !SOURCE_ORDER.includes(s))
    .sort();

  [...knownSources, ...unknownSources].forEach((src) => {
    const list = bySource.get(src)!;
    list.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    sourceGroups.push({
      source: src,
      label: getSourceLabel(src),
      sessions: list,
    });
  });

  return {
    displayPath,
    normalizedPath,
    sourceGroups,
    totalCount: sessions.length,
  };
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function SessionPanel() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const recentFolders = useWorkspace((s) => s.recentFolders);
  const setRootPath = useWorkspace((s) => s.setRootPath);

  const allSessions = useSession((s) => s.allSessions);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const restoreLatest = useSession((s) => s.restoreLatest);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const newSession = useSession((s) => s.newSession);
  const loadingSessionId = useSession((s) => s.loadingSessionId);
  const currentSessionId = useChat((s) => s.sessionId);

  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [filterTipOpen, setFilterTipOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<SessionSummary | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sessionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 初次加载 + 当前工作区变化时刷新
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions, rootPath]);

  // 构建工作区分组
  const workspaceGroups = useMemo(() => {
    if (!rootPath) return [];
    const normalizedRoot = normalizePathForCompare(rootPath);
    // Include sessions that:
    // 1. Match the current workspace, OR
    // 2. Have no workspace (from ai-base WebSocket sessions)
    const currentWorkspaceSessions = allSessions.filter(
      (session) =>
        !session.workspace ||
        normalizePathForCompare(session.workspace) === normalizedRoot,
    );
    return [
      buildWorkspaceGroup(normalizedRoot, rootPath, currentWorkspaceSessions),
    ];
  }, [allSessions, rootPath]);

  // 搜索过滤
  const filteredWorkspaceGroups = useMemo(() => {
    if (!searchQuery.trim()) return workspaceGroups;

    const query = searchQuery.toLowerCase();
    return workspaceGroups
      .map((ws) => ({
        ...ws,
        sourceGroups: ws.sourceGroups
          .map((sg) => ({
            ...sg,
            sessions: sg.sessions.filter((s) =>
              (s.title || "").toLowerCase().includes(query),
            ),
          }))
          .filter((sg) => sg.sessions.length > 0),
      }))
      .filter((ws) => ws.sourceGroups.length > 0);
  }, [workspaceGroups, searchQuery]);

  const handleNewSession = useCallback(
    (e: React.MouseEvent, workspace: string) => {
      e.stopPropagation();
      newSession(workspace);
    },
    [newSession],
  );

  const handleRefreshWorkspace = useCallback(() => {
    loadAllSessions();
  }, [loadAllSessions]);

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      switchSession(sessionId);
    },
    [switchSession],
  );

  const handleCompaction = useCallback(async (sessionId: string) => {
    const result = await triggerCompaction(sessionId);
    if (result) {
      useNotification.getState().addNotification({
        level: "info",
        message: "归档任务已触发",
      });
    } else {
      useNotification.getState().addNotification({
        level: "error",
        message: "归档任务触发失败",
      });
    }
  }, []);

  const handleRenameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      if (!newTitle.trim()) return;
      const result = await updateSession(sessionId, { title: newTitle.trim() });
      if (result && "status" in result && result.status === "updated") {
        // 刷新会话列表
        loadAllSessions();
        useNotification.getState().addNotification({
          level: "info",
          message: "会话已重命名",
        });
      } else {
        useNotification.getState().addNotification({
          level: "error",
          message: "重命名失败",
        });
      }
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
            action: () => {
              navigator.clipboard.writeText(session.session_id);
            },
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
          { id: "sep", label: "", separator: true, action: () => {} },
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
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else {
        setSearchQuery("");
      }
      return !prev;
    });
  }, []);

  const handleSelectWorkspace = useCallback(
    (folder: string) => {
      setRootPath(folder);
      void restoreLatest(folder);
      setWorkspaceMenuOpen(false);
    },
    [setRootPath, restoreLatest],
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await window.desktop.fs.selectFolder();
      if (result?.path) {
        setRootPath(result.path);
        void restoreLatest(result.path);
        setWorkspaceMenuOpen(false);
      }
    } catch {
      // ignore
    }
  }, [setRootPath, restoreLatest]);

  const getWorkspaceAbbrev = useCallback((folder: string) => {
    const name = folder.split(/[\\/]/).pop() || folder;
    const words = name
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }, []);

  const getWorkspaceColor = useCallback((folder: string) => {
    let hash = 0;
    for (let i = 0; i < folder.length; i++) {
      hash = (hash * 31 + folder.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 65% 45%)`;
  }, []);

  // 点击外部关闭工作区菜单
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        workspaceMenuRef.current &&
        !workspaceMenuRef.current.contains(e.target as Node)
      ) {
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [workspaceMenuOpen]);

  const currentWorkspace = filteredWorkspaceGroups[0];
  const currentWorkspaceName = folderName(rootPath || "未打开文件夹");
  const sourceOptions = useMemo(() => {
    if (!currentWorkspace) return [];
    return currentWorkspace.sourceGroups.map((group) => ({
      value: group.source,
      label: group.label,
      count: group.sessions.length,
    }));
  }, [currentWorkspace]);
  const visibleSessions = useMemo(() => {
    if (!currentWorkspace) return [];
    if (selectedSource === "all") {
      // Deduplicate sessions by session_id when combining all source groups
      const seen = new Set<string>();
      return currentWorkspace.sourceGroups
        .flatMap((group) => group.sessions)
        .filter((session) => {
          if (seen.has(session.session_id)) return false;
          seen.add(session.session_id);
          return true;
        })
        .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    }
    const selectedGroup = currentWorkspace.sourceGroups.find(
      (group) => group.source === selectedSource,
    );
    return selectedGroup ? selectedGroup.sessions : [];
  }, [currentWorkspace, selectedSource]);
  const displayedSessions = useMemo(
    () => (showAllSessions ? visibleSessions : visibleSessions.slice(0, 5)),
    [visibleSessions, showAllSessions],
  );
  const hasMoreSessions = visibleSessions.length > 5;
  const groupedDisplayedSessions = useMemo(() => {
    const grouped: Record<SessionTimeBucketKey, SessionSummary[]> = {
      running: [],
      just_now: [],
      today: [],
      yesterday: [],
      long_ago: [],
    };
    displayedSessions.forEach((session) => {
      const isRunning = false; // TODO: check streaming state via ws-stream-manager
      const bucket = getSessionTimeBucket(session.updated_at ?? 0, isRunning);
      grouped[bucket].push(session);
    });
    return SESSION_TIME_BUCKETS.map((bucket) => ({
      ...bucket,
      sessions: grouped[bucket.key],
    })).filter((bucket) => bucket.sessions.length > 0);
  }, [displayedSessions]);

  useEffect(() => {
    if (!currentWorkspace) return;
    if (
      selectedSource !== "all" &&
      !currentWorkspace.sourceGroups.some(
        (group) => group.source === selectedSource,
      )
    ) {
      setSelectedSource("all");
    }
  }, [currentWorkspace, selectedSource]);

  useEffect(() => {
    setShowAllSessions(false);
  }, [selectedSource, searchQuery, currentWorkspace?.normalizedPath]);

  const selectedSourceLabel = useMemo(() => {
    if (selectedSource === "all") return "全部";
    const found = sourceOptions.find(
      (option) => option.value === selectedSource,
    );
    return found ? found.label : "全部";
  }, [selectedSource, sourceOptions]);
  const sourceBadgeText = useMemo(() => {
    if (selectedSource === "all") return "A";
    return selectedSourceLabel.slice(0, 1).toUpperCase();
  }, [selectedSource, selectedSourceLabel]);

  const handleCycleSourceFilter = useCallback(() => {
    const values = ["all", ...sourceOptions.map((option) => option.value)];
    if (values.length <= 1) return;
    const currentIndex = values.indexOf(selectedSource);
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % values.length : 0;
    setSelectedSource(values[nextIndex]);
  }, [sourceOptions, selectedSource]);

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-surface text-[13px]">
        {/* 头部：工作区切换 */}
        <div ref={workspaceMenuRef} className="shrink-0 relative">
          <button
            onClick={() => setWorkspaceMenuOpen((v) => !v)}
            onMouseEnter={() => setHeaderHovered(true)}
            onMouseLeave={() => setHeaderHovered(false)}
            className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-hover transition-colors border-b border-border/50"
          >
            <span
              className="shrink-0 w-9 h-9 rounded-lg text-[12px] font-semibold flex items-center justify-center text-white"
              style={{
                backgroundColor: rootPath
                  ? getWorkspaceColor(rootPath)
                  : "#3c3c3c",
              }}
            >
              {rootPath ? getWorkspaceAbbrev(rootPath) : "?"}
            </span>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[13px] text-t-primary truncate font-medium">
                {currentWorkspaceName}
              </div>
            </div>
            <ChevronsUpDown
              size={15}
              className={`shrink-0 text-t-ghost transition-colors ${headerHovered || workspaceMenuOpen ? "text-t-muted" : ""}`}
            />
          </button>

          {/* 工作区下拉菜单 */}
          {workspaceMenuOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-elevated border border-border-subtle rounded-lg shadow-2xl py-2 z-[50]">
              <div className="px-3 pb-2 mb-2 border-b border-border/50">
                <span className="text-[11px] text-t-ghost uppercase tracking-wider">
                  Workspaces
                </span>
              </div>
              {recentFolders.map((folder) => {
                const isActive =
                  !!rootPath &&
                  normalizePathForCompare(rootPath) ===
                    normalizePathForCompare(folder);
                return (
                  <button
                    key={folder}
                    onClick={() => handleSelectWorkspace(folder)}
                    className={`w-full flex items-center gap-3 px-3 py-3 relative transition-all duration-150 ease-out ${
                      isActive
                        ? "text-neon bg-neon/[0.06]"
                        : "text-t-muted hover:text-t-primary hover:bg-hover active:scale-[0.98] active:duration-100"
                    }`}
                  >
                    <span
                      className="shrink-0 w-7 h-7 rounded-md text-[11px] font-semibold flex items-center justify-center text-white"
                      style={{ backgroundColor: getWorkspaceColor(folder) }}
                    >
                      {getWorkspaceAbbrev(folder)}
                    </span>
                    <span className="truncate flex-1 text-left text-[13px]">
                      {folderName(folder)}
                    </span>
                  </button>
                );
              })}
              <div className="h-px bg-border/50 my-2" />
              <button
                onClick={handleOpenFolder}
                className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-t-dim hover:text-t-primary transition-colors"
              >
                <FolderOpen size={14} />
                <span>Open folder...</span>
              </button>
            </div>
          )}
        </div>

        {/* 新增会话 + 搜索 + 刷新 */}
        <div className="shrink-0 px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={(e) => handleNewSession(e, rootPath || "")}
            disabled={!rootPath}
            className="flex-1 h-9 rounded-md text-[12px] border border-border-subtle bg-elevated hover:bg-panel text-t-secondary hover:text-neon transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Plus size={15} />
            <span>新增会话</span>
          </button>
          <Tooltip content="搜索会话" side="bottom">
            <button
              onClick={handleSearchToggle}
              className={`flex items-center justify-center h-9 w-9 rounded transition-colors ${
                searchOpen
                  ? "text-neon bg-neon/10"
                  : "text-t-secondary bg-elevated hover:bg-panel hover:text-neon"
              }`}
            >
              <Search size={15} />
            </button>
          </Tooltip>
          <Tooltip content="刷新会话" side="bottom">
            <button
              onClick={handleRefreshWorkspace}
              className="flex items-center justify-center h-9 w-9 rounded text-t-secondary bg-elevated hover:bg-panel hover:text-neon transition-colors"
            >
              <RefreshCw size={15} />
            </button>
          </Tooltip>
        </div>

        {/* 搜索框（展开时显示） */}
        {searchOpen && (
          <div className="shrink-0 px-3 py-2 border-b border-border">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full h-8 px-3 rounded bg-elevated border border-border/50 focus:border-neon/50 text-[12px] text-t-primary placeholder:text-t-ghost outline-none transition-colors"
            />
          </div>
        )}

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto scrollbar-thin"
        >
          {!currentWorkspace ? (
            <div className="text-t-ghost px-4 py-12 text-center">
              {searchQuery ? "No matching sessions" : "No sessions"}
            </div>
          ) : (
            <div className="px-2 py-2">
              {visibleSessions.length === 0 ? (
                <div className="text-t-ghost px-2 py-8 text-center text-[12px]">
                  当前分类下暂无会话
                </div>
              ) : (
                groupedDisplayedSessions.map((bucket) => (
                  <div key={bucket.key} className="mb-2">
                    <div className="px-1 py-1 text-[10px] text-t-ghost">
                      {bucket.label}
                    </div>
                    {bucket.sessions.map((session, idx) => {
                      const stripPrefix = (id: string) =>
                        id.includes(":") ? id.substring(id.indexOf(":") + 1) : id;
                      const isSessionActive =
                        stripPrefix(session.session_id) === stripPrefix(currentSessionId || "");
                      const isSessionHovered =
                        hoveredSession === session.session_id;
                      const isStreaming = false; // TODO: check via ws-stream-manager
                      const isLoading = loadingSessionId === session.session_id;
                      const time = timeAgo(session.updated_at ?? 0);
                      const ChannelIcon = getChannelIcon(session.channel);
                      const channelLabel = getChannelLabel(session.channel);

                      return (
                        <div
                          key={`${bucket.key}-${session.session_id}-${idx}`}
                          ref={(el) => {
                            if (el) {
                              sessionRefs.current.set(session.session_id, el);
                            } else {
                              sessionRefs.current.delete(session.session_id);
                            }
                          }}
                          onClick={() =>
                            handleSwitchSession(session.session_id)
                          }
                          onMouseEnter={() =>
                            setHoveredSession(session.session_id)
                          }
                          onMouseLeave={() => setHoveredSession(null)}
                          className={`
                          mt-1 flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors rounded-md border border-transparent
                          ${
                            isSessionActive
                              ? "bg-active"
                              : "bg-transparent border-border/30 hover:bg-hover"
                          }
                        `}
                        >
                          <div className="flex-1 min-w-0">
                            <div
                              className={`truncate text-[13px] ${
                                isSessionActive
                                  ? "text-t-primary"
                                  : "text-t-secondary"
                              }`}
                            >
                              {session.title || "New Session"}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {/* Channel icon - only show for non-websocket */}
                              {session.channel &&
                                session.channel !== "websocket" && (
                                  <Tooltip content={channelLabel} side="top">
                                    <span className="text-t-ghost">
                                      <ChannelIcon size={10} />
                                    </span>
                                  </Tooltip>
                                )}
                              <span
                                className="text-[11px]"
                                style={{
                                  opacity: time.opacity,
                                  color: "var(--color-t-dim)",
                                }}
                              >
                                {time.text}
                              </span>
                              {isStreaming && (
                                <Loader2
                                  size={10}
                                  className="text-neon animate-spin"
                                />
                              )}
                              {isLoading && !isStreaming && (
                                <Loader2
                                  size={10}
                                  className="text-t-ghost animate-spin"
                                />
                              )}
                            </div>
                          </div>
                          {isSessionHovered && (
                            <button
                              onClick={(e) => showSessionMenu(e, session)}
                              className="shrink-0 p-1 rounded text-t-dim hover:text-t-primary hover:bg-hover transition-colors"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              {hasMoreSessions && (
                <button
                  type="button"
                  onClick={() => setShowAllSessions((prev) => !prev)}
                  className="w-full mt-2 py-1.5 text-[11px] text-t-ghost hover:text-neon transition-colors"
                >
                  {showAllSessions
                    ? "收起"
                    : `展示全部（${visibleSessions.length}）`}
                </button>
              )}
            </div>
          )}
        </div>

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
                      handleRenameSession(
                        renamingSession.session_id,
                        renameValue,
                      );
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
