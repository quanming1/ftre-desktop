import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Plus,
  MoreHorizontal,
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

type SessionTimeBucketKey =
  | "running"
  | "just_now"
  | "today"
  | "yesterday"
  | "long_ago";

const SESSION_TIME_BUCKETS: Array<{ key: SessionTimeBucketKey; label: string }> = [
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

  const allSessions = useSession((s) => s.allSessions);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const newSession = useSession((s) => s.newSession);
  const currentSessionId = useChat((s) => s.sessionId);

  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<SessionSummary | null>(null);
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
    const normalizedRoot = normalizePath(rootPath);
    const currentWorkspaceSessions = allSessions.filter(
      (session) =>
        session.workspace && normalizePath(session.workspace) === normalizedRoot,
    );
    return [
      buildWorkspaceGroup(
        normalizedRoot,
        rootPath,
        currentWorkspaceSessions,
      ),
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

  const loadWorkspaceSessions = useSession((s) => s.loadWorkspaceSessions);

  const handleNewSession = useCallback(
    (e: React.MouseEvent, workspace: string) => {
      e.stopPropagation();
      newSession(workspace);
    },
    [newSession],
  );

  const handleRefreshWorkspace = useCallback(() => {
    if (!rootPath) return;
    loadWorkspaceSessions(rootPath);
  }, [rootPath, loadWorkspaceSessions]);

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
      return currentWorkspace.sourceGroups
        .flatMap((group) => group.sessions)
        .sort((a, b) => b.updated_at - a.updated_at);
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
      const isRunning = streamManager.isSessionStreaming(session.session_id);
      const bucket = getSessionTimeBucket(session.updated_at, isRunning);
      grouped[bucket].push(session);
    });
    return SESSION_TIME_BUCKETS
      .map((bucket) => ({
        ...bucket,
        sessions: grouped[bucket.key],
      }))
      .filter((bucket) => bucket.sessions.length > 0);
  }, [displayedSessions]);

  useEffect(() => {
    if (!currentWorkspace) return;
    if (
      selectedSource !== "all" &&
      !currentWorkspace.sourceGroups.some((group) => group.source === selectedSource)
    ) {
      setSelectedSource("all");
    }
  }, [currentWorkspace, selectedSource]);

  useEffect(() => {
    setShowAllSessions(false);
  }, [selectedSource, searchQuery, currentWorkspace?.normalizedPath]);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target as Node)) {
        setSourceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sourceMenuOpen]);

  const selectedSourceLabel = useMemo(() => {
    if (selectedSource === "all") return "全部";
    const found = sourceOptions.find((option) => option.value === selectedSource);
    return found ? found.label : "全部";
  }, [selectedSource, sourceOptions]);

  return (
    <div className="h-full flex flex-col bg-surface text-[13px]">
      {/* 头部：工作区 + 搜索/刷新 + 新增会话 */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-t-primary truncate flex-1">
            {currentWorkspaceName}
          </span>
          <button
            onClick={handleSearchToggle}
            className={`flex items-center justify-center h-7 w-7 rounded transition-colors ${
              searchOpen
                ? "text-neon bg-neon/10"
                : "text-t-secondary bg-elevated hover:bg-panel hover:text-neon"
            }`}
            title="搜索会话"
          >
            <Search size={14} />
          </button>
          <button
            onClick={handleRefreshWorkspace}
            className="flex items-center justify-center h-7 w-7 rounded text-t-secondary bg-elevated hover:bg-panel hover:text-neon transition-colors"
            title="刷新会话"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="text-[11px] text-t-ghost truncate mt-1">
          {rootPath || "未打开文件夹"}
        </div>
        <button
          onClick={(e) => handleNewSession(e, rootPath || "")}
          disabled={!rootPath}
          className="w-full mt-2 h-9 rounded-md text-[12px] border border-border-subtle bg-elevated hover:bg-panel text-t-secondary hover:text-neon transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <Plus size={14} />
          <span>新增会话</span>
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

      <div className="shrink-0 px-3 py-1.5 border-b border-border">
        <div className="flex items-center gap-2" ref={sourceMenuRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSourceMenuOpen((prev) => !prev)}
              className="h-7 px-1.5 rounded bg-transparent border border-transparent text-[12px] text-t-secondary outline-none hover:bg-elevated/70 focus:bg-elevated focus:border-border-subtle transition-colors"
            >
              {selectedSourceLabel}
            </button>
            {sourceMenuOpen && (
              <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-elevated border border-border-subtle rounded-lg shadow-2xl py-1 z-[40]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSource("all");
                    setSourceMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                    selectedSource === "all"
                      ? "text-neon bg-neon/10"
                      : "text-t-secondary hover:bg-white/[0.08] hover:text-t-primary"
                  }`}
                >
                  全部
                </button>
                {sourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSelectedSource(option.value);
                      setSourceMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                      selectedSource === option.value
                        ? "text-neon bg-neon/10"
                        : "text-t-secondary hover:bg-white/[0.08] hover:text-t-primary"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
                  {bucket.sessions.map((session) => {
                    const isSessionActive = session.session_id === currentSessionId;
                    const isSessionHovered = hoveredSession === session.session_id;
                    const isStreaming = streamManager.isSessionStreaming(
                      session.session_id,
                    );
                    const time = timeAgo(session.updated_at);

                    return (
                      <div
                        key={session.session_id}
                        ref={(el) => {
                          if (el) {
                            sessionRefs.current.set(session.session_id, el);
                          } else {
                            sessionRefs.current.delete(session.session_id);
                          }
                        }}
                        onClick={() => handleSwitchSession(session.session_id)}
                        onMouseEnter={() => setHoveredSession(session.session_id)}
                        onMouseLeave={() => setHoveredSession(null)}
                        className={`
                          mt-1 flex items-center gap-2 px-3 py-2 cursor-pointer select-none transition-colors rounded-md border border-transparent
                          ${
                            isSessionActive
                              ? "bg-white/[0.06]"
                              : "bg-transparent border-border/30 hover:bg-white/[0.03]"
                          }
                        `}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            className={`truncate text-[12px] ${
                              isSessionActive ? "text-t-primary" : "text-t-secondary"
                            }`}
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
                              <Loader2 size={10} className="text-neon animate-spin" />
                            )}
                          </div>
                        </div>
                        {isSessionHovered && (
                          <button
                            onClick={(e) => showSessionMenu(e, session)}
                            className="shrink-0 p-1 rounded text-t-dim hover:text-t-primary hover:bg-white/[0.08] transition-colors"
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
                {showAllSessions ? "收起" : `展示全部（${visibleSessions.length}）`}
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
