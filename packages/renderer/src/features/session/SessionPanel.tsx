import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  MoreHorizontal,
  FolderOpen,
  LocateFixed,
  Search,
  Loader2,
  RefreshCw,
  Archive,
  Pencil,
} from "lucide-react";
import { useSession } from "@/stores/session";
import { useChat } from "@/stores/chat";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import { streamManager } from "@/services/stream-manager";
import { triggerCompaction, updateSession } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import type { SessionSummary } from "@/services/api";

// ─── 颜色系统 ──────────────────────────────────────────────────────

const WORKSPACE_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#f97316", // orange
  "#14b8a6", // teal
  "#e11d48", // rose
  "#a855f7", // purple
  "#84cc16", // lime
];

function pathHash(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getWorkspaceColor(path: string): string {
  return WORKSPACE_COLORS[pathHash(path) % WORKSPACE_COLORS.length];
}

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

function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
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
    list.sort((a, b) => b.updated_at - a.updated_at);
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
  const removeRecentFolder = useWorkspace((s) => s.removeRecentFolder);

  const allSessions = useSession((s) => s.allSessions);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const newSession = useSession((s) => s.newSession);
  const currentSessionId = useChat((s) => s.sessionId);

  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => {
      const norm = normalizePath(rootPath || "");
      return norm ? new Set([norm]) : new Set();
    },
  );
  const [expandedSources, setExpandedSources] = useState<Set<string>>(() => {
    const norm = normalizePath(rootPath || "");
    return norm ? new Set([`${norm}:user`]) : new Set();
  });
  const [expandedFullSources, setExpandedFullSources] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sessionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 初次加载 + recentFolders 变化时刷新
  const recentFoldersCount = recentFolders.length;
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions, recentFoldersCount]);

  useEffect(() => {
    if (rootPath) {
      const norm = normalizePath(rootPath);
      setExpandedWorkspaces((prev) => new Set([...prev, norm]));
      setExpandedSources((prev) => {
        const next = new Set(prev);
        next.add(`${norm}:user`);
        return next;
      });
    }
  }, [rootPath]);

  // 构建工作区分组
  const workspaceGroups = useMemo(() => {
    const normalizedMap = new Map<
      string,
      { displayPath: string; sessions: SessionSummary[] }
    >();

    recentFolders.forEach((folder) => {
      const norm = normalizePath(folder);
      if (!normalizedMap.has(norm)) {
        normalizedMap.set(norm, { displayPath: folder, sessions: [] });
      }
    });

    allSessions.forEach((session) => {
      if (!session.workspace) return;
      const norm = normalizePath(session.workspace);
      if (normalizedMap.has(norm)) {
        normalizedMap.get(norm)!.sessions.push(session);
      } else {
        normalizedMap.set(norm, {
          displayPath: session.workspace,
          sessions: [session],
        });
      }
    });

    const groups: WorkspaceGroup[] = [];
    const seen = new Set<string>();

    recentFolders.forEach((folder) => {
      const norm = normalizePath(folder);
      if (!seen.has(norm) && normalizedMap.has(norm)) {
        const data = normalizedMap.get(norm)!;
        groups.push(buildWorkspaceGroup(norm, data.displayPath, data.sessions));
        seen.add(norm);
      }
    });

    normalizedMap.forEach((data, norm) => {
      if (!seen.has(norm)) {
        groups.push(buildWorkspaceGroup(norm, data.displayPath, data.sessions));
        seen.add(norm);
      }
    });

    return groups;
  }, [allSessions, recentFolders]);

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

  const loadWorkspaceSessions = useSession((s) => s.loadWorkspaceSessions);

  const toggleWorkspace = useCallback(
    (normalizedPath: string, displayPath: string) => {
      // 先检查当前是否展开，再执行 toggle
      const wasExpanded = expandedWorkspaces.has(normalizedPath);

      setExpandedWorkspaces((prev) => {
        const next = new Set(prev);
        if (next.has(normalizedPath)) {
          next.delete(normalizedPath);
        } else {
          next.add(normalizedPath);
        }
        return next;
      });

      // 如果之前是折叠的（即现在是展开操作）：设置默认展开的 source，并刷新会话列表
      if (!wasExpanded) {
        setExpandedSources((prev) => {
          const next = new Set(prev);
          next.add(`${normalizedPath}:user`);
          return next;
        });
        loadWorkspaceSessions(displayPath);
      }
    },
    [expandedWorkspaces, loadWorkspaceSessions],
  );

  const toggleSource = useCallback((wsPath: string, source: string) => {
    const key = `${wsPath}:${source}`;
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await window.desktop.fs.selectFolder();
      if (result?.path) {
        setRootPath(result.path);
      }
    } catch {}
  }, [setRootPath]);

  const handleLocateCurrentSession = useCallback(() => {
    if (!currentSessionId) return;

    // 找到当前 session 所在的工作区和 source
    const session = allSessions.find((s) => s.session_id === currentSessionId);
    if (session?.workspace) {
      const wsNorm = normalizePath(session.workspace);
      const source = session.source || "user";
      const sourceKey = `${wsNorm}:${source}`;

      // 展开工作区
      setExpandedWorkspaces((prev) => {
        if (prev.has(wsNorm)) return prev;
        return new Set([...prev, wsNorm]);
      });

      // 展开 source
      setExpandedSources((prev) => {
        if (prev.has(sourceKey)) return prev;
        return new Set([...prev, sourceKey]);
      });

      // 延迟滚动，等待 DOM 更新
      setTimeout(() => {
        const el = sessionRefs.current.get(currentSessionId);
        if (el && scrollContainerRef.current) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
    } else {
      // 没有找到 session 信息，直接尝试滚动
      const el = sessionRefs.current.get(currentSessionId);
      if (el && scrollContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentSessionId, allSessions]);

  const toggleShowAllSessions = useCallback((sourceKey: string) => {
    setExpandedFullSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceKey)) {
        next.delete(sourceKey);
      } else {
        next.add(sourceKey);
      }
      return next;
    });
  }, []);

  const handleNewSession = useCallback(
    (e: React.MouseEvent, workspace: string) => {
      e.stopPropagation();
      newSession(workspace);
    },
    [newSession],
  );

  const handleRefreshWorkspace = useCallback(
    (e: React.MouseEvent, workspace: string) => {
      e.stopPropagation();
      loadWorkspaceSessions(workspace);
    },
    [loadWorkspaceSessions],
  );

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

  const showWorkspaceMenu = useCallback(
    (e: React.MouseEvent, workspace: string) => {
      e.stopPropagation();
      e.preventDefault();
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "remove-workspace",
            label: "移除工作区",
            action: () => removeRecentFolder(workspace),
          },
        ],
      });
    },
    [removeRecentFolder],
  );

  const currentNormalized = normalizePath(rootPath || "");

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

  return (
    <div className="h-full flex flex-col bg-surface text-[13px]">
      {/* 顶部按钮区 */}
      <div className="shrink-0 px-2.5 py-2 border-b border-border flex items-center gap-1.5">
        <button
          onClick={handleOpenFolder}
          className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-[12px] text-t-secondary bg-elevated hover:bg-panel hover:text-neon transition-colors"
          title="Open Workspace"
        >
          <FolderOpen size={14} />
          <span>Open</span>
        </button>
        <button
          onClick={handleLocateCurrentSession}
          className="flex items-center justify-center h-7 w-7 rounded text-t-secondary bg-elevated hover:bg-panel hover:text-neon transition-colors"
          title="Locate Current Session"
        >
          <LocateFixed size={14} />
        </button>
        <button
          onClick={handleSearchToggle}
          className={`flex items-center justify-center h-7 w-7 rounded transition-colors ${
            searchOpen
              ? "text-neon bg-neon/10"
              : "text-t-secondary bg-elevated hover:bg-panel hover:text-neon"
          }`}
          title="Search Sessions"
        >
          <Search size={14} />
        </button>
      </div>

      {/* 搜索框（展开时显示） */}
      {searchOpen && (
        <div className="shrink-0 px-2.5 py-1.5 border-b border-border">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full h-7 px-3 rounded bg-elevated border border-neon/30 focus:border-neon/50 text-[12px] text-t-primary placeholder:text-t-ghost outline-none transition-colors"
          />
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        {filteredWorkspaceGroups.length === 0 ? (
          <div className="text-t-ghost px-4 py-12 text-center">
            {searchQuery ? "No matching sessions" : "No workspaces"}
          </div>
        ) : (
          filteredWorkspaceGroups.map((ws) => {
            const isActive = ws.normalizedPath === currentNormalized;
            const isExpanded = expandedWorkspaces.has(ws.normalizedPath);
            const isHovered = hoveredWorkspace === ws.normalizedPath;
            const wsColor = getWorkspaceColor(ws.normalizedPath);

            return (
              <div
                key={ws.normalizedPath}
                className="mx-2 mt-2 rounded-lg"
                style={
                  isExpanded
                    ? {
                        border: `1px solid ${wsColor}50`,
                        boxShadow: `inset 0 1px 4px ${wsColor}12`,
                      }
                    : {
                        border: "1px solid transparent",
                      }
                }
              >
                {/* Workspace Header — sticky */}
                <div
                  onClick={() =>
                    toggleWorkspace(ws.normalizedPath, ws.displayPath)
                  }
                  onMouseEnter={() => setHoveredWorkspace(ws.normalizedPath)}
                  onMouseLeave={() => setHoveredWorkspace(null)}
                  className={`
                    sticky top-0 z-10 cursor-pointer select-none px-3
                    rounded-t-lg
                    ${isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}
                    ${isExpanded ? "py-2.5" : "py-1.5 rounded-b-lg"}
                    transition-all
                  `}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-t-muted">
                      {isExpanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </span>
                    <span
                      className={`flex-1 truncate font-semibold ${isExpanded ? "text-[15px]" : "text-[13px]"} ${isActive ? "text-t-primary" : "text-t-primary"}`}
                    >
                      {folderName(ws.displayPath)}
                    </span>
                    <div
                      className={`flex items-center gap-0.5 ${isHovered ? "opacity-100" : "opacity-0"}`}
                    >
                      <button
                        onClick={(e) =>
                          handleRefreshWorkspace(e, ws.displayPath)
                        }
                        className="p-1 rounded text-t-dim hover:text-neon hover:bg-white/[0.08] transition-colors"
                        title="Refresh Sessions"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={(e) => handleNewSession(e, ws.displayPath)}
                        className="p-1 rounded text-t-dim hover:text-neon hover:bg-white/[0.08] transition-colors"
                        title="New Session"
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        onClick={(e) => showWorkspaceMenu(e, ws.displayPath)}
                        className="p-1 rounded text-t-dim hover:text-t-primary hover:bg-white/[0.08] transition-colors"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="text-[11px] text-t-dim truncate mt-1 ml-[24px]">
                      {ws.displayPath}
                    </div>
                  )}
                </div>

                {/* Source 分组 + Sessions */}
                {isExpanded && (
                  <div className="rounded-b-lg overflow-hidden">
                    {ws.sourceGroups.map((sg) => {
                      const sourceKey = `${ws.normalizedPath}:${sg.source}`;
                      const isSourceExpanded = expandedSources.has(sourceKey);
                      const showAll = expandedFullSources.has(sourceKey);
                      const maxVisible = 5;
                      const visibleSessions = showAll
                        ? sg.sessions
                        : sg.sessions.slice(0, maxVisible);
                      const hasMore = sg.sessions.length > maxVisible;

                      return (
                        <div key={sourceKey}>
                          {/* Source 分割线 */}
                          <div
                            onClick={() =>
                              toggleSource(ws.normalizedPath, sg.source)
                            }
                            className="flex items-center gap-2 px-3 py-1 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
                          >
                            <div className="flex-1 h-px bg-border" />
                            <span className="text-[10px] text-t-ghost px-1.5">
                              {sg.label}
                              {!isSourceExpanded && ` (${sg.sessions.length})`}
                            </span>
                            <div className="flex-1 h-px bg-border" />
                          </div>

                          {/* Sessions */}
                          {isSourceExpanded && (
                            <>
                              {visibleSessions.map((session) => {
                                const isSessionActive =
                                  session.session_id === currentSessionId;
                                const isSessionHovered =
                                  hoveredSession === session.session_id;
                                const isStreaming =
                                  streamManager.isSessionStreaming(
                                    session.session_id,
                                  );
                                const time = timeAgo(session.updated_at);

                                return (
                                  <div
                                    key={session.session_id}
                                    ref={(el) => {
                                      if (el) {
                                        sessionRefs.current.set(
                                          session.session_id,
                                          el,
                                        );
                                      } else {
                                        sessionRefs.current.delete(
                                          session.session_id,
                                        );
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
                                      flex items-center gap-2 px-3 py-2 cursor-pointer select-none transition-colors
                                      ${
                                        isSessionActive
                                          ? "bg-white/[0.06]"
                                          : "hover:bg-white/[0.03]"
                                      }
                                    `}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div
                                        className={`truncate text-[12px] ${isSessionActive ? "text-t-primary" : "text-t-secondary"}`}
                                      >
                                        {session.title || "New Session"}
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <span
                                          className="text-[10px]"
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
                                      </div>
                                    </div>
                                    {isSessionHovered && (
                                      <button
                                        onClick={(e) =>
                                          showSessionMenu(e, session)
                                        }
                                        className="shrink-0 p-1 rounded text-t-dim hover:text-t-primary hover:bg-white/[0.08] transition-colors"
                                      >
                                        <MoreHorizontal size={14} />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                              {/* Show all / Show less */}
                              {hasMore && (
                                <button
                                  onClick={() =>
                                    toggleShowAllSessions(sourceKey)
                                  }
                                  className="w-full text-center py-1.5 text-[10px] text-t-ghost hover:text-neon transition-colors"
                                >
                                  {showAll
                                    ? "Show less"
                                    : `Show all ${sg.sessions.length}`}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
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
                className="px-3 py-1.5 rounded text-[12px] text-t-muted hover:bg-white/[0.06]"
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
  );
}
