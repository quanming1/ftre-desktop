import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal, FolderOpen, LocateFixed } from "lucide-react";
import { useSession } from "@/stores/session";
import { useChat } from "@/stores/chat";
import { useWorkspace } from "@/stores/workspace";
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

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
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
  return SOURCE_LABELS[source] || source.charAt(0).toUpperCase() + source.slice(1);
}

function buildWorkspaceGroup(
  normalizedPath: string,
  displayPath: string,
  sessions: SessionSummary[]
): WorkspaceGroup {
  const bySource = new Map<string, SessionSummary[]>();
  sessions.forEach((s) => {
    const src = s.source || "user";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src)!.push(s);
  });

  const sourceGroups: SourceGroup[] = [];
  const knownSources = SOURCE_ORDER.filter((s) => bySource.has(s));
  const unknownSources = [...bySource.keys()].filter((s) => !SOURCE_ORDER.includes(s)).sort();

  [...knownSources, ...unknownSources].forEach((src) => {
    const list = bySource.get(src)!;
    list.sort((a, b) => b.updated_at - a.updated_at);
    sourceGroups.push({ source: src, label: getSourceLabel(src), sessions: list });
  });

  return { displayPath, normalizedPath, sourceGroups, totalCount: sessions.length };
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
    () => new Set([normalizePath(rootPath || "")])
  );
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [expandedFullSources, setExpandedFullSources] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sessionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions]);

  useEffect(() => {
    if (rootPath) {
      const norm = normalizePath(rootPath);
      setExpandedWorkspaces((prev) => new Set([...prev, norm]));
      setExpandedSources((prev) => {
        const next = new Set(prev);
        SOURCE_ORDER.forEach((s) => next.add(`${norm}:${s}`));
        return next;
      });
      loadAllSessions();
    }
  }, [rootPath, loadAllSessions]);

  // 构建工作区分组
  const workspaceGroups = useMemo(() => {
    const normalizedMap = new Map<string, { displayPath: string; sessions: SessionSummary[] }>();

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
        normalizedMap.set(norm, { displayPath: session.workspace, sessions: [session] });
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

  const toggleWorkspace = useCallback((normalizedPath: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(normalizedPath)) {
        next.delete(normalizedPath);
      } else {
        next.add(normalizedPath);
      }
      return next;
    });
  }, []);

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
    const el = sessionRefs.current.get(currentSessionId);
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSessionId]);

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
    [newSession]
  );

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      switchSession(sessionId);
    },
    [switchSession]
  );

  const showSessionMenu = useCallback(
    (e: React.MouseEvent, session: SessionSummary) => {
      e.stopPropagation();
      e.preventDefault();
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "delete-session",
            label: "删除会话",
            action: () => deleteSession(session.session_id),
          },
        ],
      });
    },
    [deleteSession]
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
    [removeRecentFolder]
  );

  const currentNormalized = normalizePath(rootPath || "");

  return (
    <div className="h-full flex flex-col bg-surface text-[13px]">
      {/* 顶部按钮区 */}
      <div className="shrink-0 px-2.5 py-2 border-b border-border flex items-center gap-2">
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
          className="flex items-center justify-center gap-1.5 h-7 px-2.5 rounded text-[12px] text-t-secondary bg-elevated hover:bg-panel hover:text-neon transition-colors"
          title="Locate Current Session"
        >
          <LocateFixed size={14} />
        </button>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {workspaceGroups.length === 0 ? (
          <div className="text-t-ghost px-4 py-12 text-center font-mono">
            No workspaces
          </div>
        ) : (
          workspaceGroups.map((ws) => {
            const isActive = ws.normalizedPath === currentNormalized;
            const isExpanded = expandedWorkspaces.has(ws.normalizedPath);
            const isHovered = hoveredWorkspace === ws.normalizedPath;
            const wsColor = getWorkspaceColor(ws.normalizedPath);

            return (
              <div
                key={ws.normalizedPath}
                className="mx-2 mt-2"
              >
                {/* Workspace Header — sticky */}
                <div
                  onClick={() => toggleWorkspace(ws.normalizedPath)}
                  onMouseEnter={() => setHoveredWorkspace(ws.normalizedPath)}
                  onMouseLeave={() => setHoveredWorkspace(null)}
                  className={`
                    sticky top-0 z-10 cursor-pointer select-none px-3 py-2.5
                    bg-surface
                    ${isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}
                  `}
                  style={{
                    border: `1px solid ${isExpanded ? wsColor + '50' : 'transparent'}`,
                    borderBottom: isExpanded ? 'none' : undefined,
                    borderRadius: isExpanded ? '8px 8px 0 0' : '8px',
                    transition: 'border-color 0.15s, border-radius 0.15s',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-t-muted">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <span className={`flex-1 truncate text-[15px] font-semibold ${isActive ? "text-t-primary" : "text-t-primary"}`}>
                      {folderName(ws.displayPath)}
                    </span>
                    {isHovered && (
                      <div className="flex items-center gap-0.5">
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
                    )}
                  </div>
                  <div className="text-[11px] text-t-dim truncate mt-1 ml-[24px]">
                    {ws.displayPath}
                  </div>
                </div>

                {/* Source 分组 + Sessions */}
                {isExpanded && (
                  <div
                    style={{
                      borderLeft: `1px solid ${wsColor}50`,
                      borderRight: `1px solid ${wsColor}50`,
                      borderBottom: `1px solid ${wsColor}50`,
                      borderRadius: '0 0 8px 8px',
                      boxShadow: `inset 0 1px 4px ${wsColor}12`,
                    }}
                  >
                    {ws.sourceGroups.map((sg, sgIndex) => {
                      const sourceKey = `${ws.normalizedPath}:${sg.source}`;
                      const isSourceExpanded = expandedSources.has(sourceKey);
                      const isLastSource = sgIndex === ws.sourceGroups.length - 1;
                      const showAll = expandedFullSources.has(sourceKey);
                      const maxVisible = 5;
                      const visibleSessions = showAll ? sg.sessions : sg.sessions.slice(0, maxVisible);
                      const hasMore = sg.sessions.length > maxVisible;

                      return (
                        <div key={sourceKey} className="relative">
                          {/* 第一级缩进线 */}
                          <div
                            className="absolute left-[18px] top-0 w-px bg-border"
                            style={{ height: isLastSource && !isSourceExpanded ? '16px' : '100%' }}
                          />
                          {/* Source Header — sticky */}
                          <div
                            onClick={() => toggleSource(ws.normalizedPath, sg.source)}
                            className="sticky top-[52px] z-[5] relative flex items-center gap-2 px-3 py-1.5 pl-8 cursor-pointer select-none bg-surface hover:bg-white/[0.02] text-t-muted transition-colors"
                          >
                            <span className="shrink-0">
                              {isSourceExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </span>
                            <span className="flex-1 text-[11px]">{sg.label}</span>
                          </div>

                          {/* Sessions */}
                          {isSourceExpanded && (
                            <>
                              {visibleSessions.map((session, sessionIndex) => {
                                const isSessionActive = session.session_id === currentSessionId;
                                const isSessionHovered = hoveredSession === session.session_id;
                                const isLastVisible = sessionIndex === visibleSessions.length - 1;
                                const isLastSession = isLastVisible && (showAll || !hasMore);

                                return (
                                  <div
                                    key={session.session_id}
                                    ref={(el) => {
                                      if (el) sessionRefs.current.set(session.session_id, el);
                                    }}
                                    className="relative"
                                  >
                                    {/* 第二级缩进线 */}
                                    <div
                                      className="absolute left-[34px] top-0 w-px bg-border"
                                      style={{ height: isLastSession ? '20px' : '100%' }}
                                    />
                                    <div
                                      onClick={() => handleSwitchSession(session.session_id)}
                                      onMouseEnter={() => setHoveredSession(session.session_id)}
                                      onMouseLeave={() => setHoveredSession(null)}
                                      className={`
                                        relative flex items-center gap-2 px-3 py-2 pl-12 cursor-pointer select-none transition-colors
                                        ${isSessionActive
                                          ? "bg-neon/10"
                                          : "hover:bg-white/[0.03]"}
                                      `}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className={`truncate text-[12px] ${isSessionActive ? "text-t-primary" : "text-t-secondary"}`}>
                                          {session.title || "New Session"}
                                        </div>
                                        <div className="text-[10px] text-t-dim mt-0.5">
                                          {timeAgo(session.updated_at)}
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
                                  </div>
                                );
                              })}
                              {/* Show all / Show less */}
                              {hasMore && (
                                <div className="relative">
                                  <div
                                    className="absolute left-[34px] top-0 w-px bg-border"
                                    style={{ height: '16px' }}
                                  />
                                  <button
                                    onClick={() => toggleShowAllSessions(sourceKey)}
                                    className="w-full text-left pl-12 pr-3 py-1.5 text-[11px] text-t-dim hover:text-neon transition-colors"
                                  >
                                    {showAll ? 'Show less' : `Show all (${sg.sessions.length})`}
                                  </button>
                                </div>
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
    </div>
  );
}