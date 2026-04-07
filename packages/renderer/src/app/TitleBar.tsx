import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Minus, Square, X, Copy, Terminal, GitBranch, ChevronRight, MessageSquare, ClipboardList, FolderOpen, ChevronDown, Check } from "lucide-react";
import { PixelLogo } from "@/components/PixelLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LayoutSwitcher } from "@/components/LayoutSwitcher";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useLayout } from "@/stores/layout";
import { useGitService } from "@/services/git-service";
import { buildMenuDefinitions, type MenuItem, type ConfirmAction } from "@/lib/menu-definitions";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const activeFile = useEditor((s) => s.activeFile);
  const rootPath = useWorkspace((s) => s.rootPath);
  const recentFolders = useWorkspace((s) => s.recentFolders);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const terminalOpen = useLayout((s) => s.terminalDropdownOpen);
  const toggleTerminal = useLayout((s) => s.toggleTerminalDropdown);
  const agentChatOpen = useLayout((s) => s.agentChatOpen);
  const toggleAgentChat = useLayout((s) => s.toggleAgentChat);
  const taskPanelOpen = useLayout((s) => s.taskPanelOpen);
  const toggleTaskPanel = useLayout((s) => s.toggleTaskPanel);
  const panelOrder = useLayout((s) => s.panelOrder);
  const setPanelOrder = useLayout((s) => s.setPanelOrder);
  const panelVisible = useLayout((s) => s.panelVisible);
  const togglePanelVisible = useLayout((s) => s.togglePanelVisible);
  const gitInfo = useGitService((s) => s.getInfo());

  const projectName = rootPath ? rootPath.split("/").pop() || rootPath.split("\\").pop() : "Ftre";
  const fileName = activeFile ? activeFile.split("/").pop() || activeFile.split("\\").pop() : null;

  const menuDefinitions = useMemo(() => buildMenuDefinitions(setConfirmAction), []);
  const menuAreaRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭 logo 菜单
  useEffect(() => {
    if (!logoMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuAreaRef.current && !menuAreaRef.current.contains(e.target as Node)) {
        setLogoMenuOpen(false);
        setHoveredMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [logoMenuOpen]);

  // 点击外部关闭工作区菜单
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [workspaceMenuOpen]);

  const handleMenuItemClick = useCallback((item: MenuItem) => {
    item.action();
    setLogoMenuOpen(false);
    setHoveredMenu(null);
  }, []);

  const handleMaximize = async () => {
    await window.desktop.window.maximize();
    setIsMaximized(await window.desktop.window.isMaximized());
  };

  const handleSelectWorkspace = useCallback((folder: string) => {
    setRootPath(folder);
    setWorkspaceMenuOpen(false);
  }, [setRootPath]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await window.desktop.fs.selectFolder();
      if (result?.path) {
        setRootPath(result.path);
        setWorkspaceMenuOpen(false);
      }
    } catch {
      // ignore
    }
  }, [setRootPath]);

  const workspaceDisplayName = rootPath
    ? rootPath.split(/[\\/]/).pop() || rootPath
    : "未打开文件夹";

  const getWorkspaceColor = useCallback((folder: string) => {
    let hash = 0;
    for (let i = 0; i < folder.length; i++) {
      hash = (hash * 31 + folder.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 65% 45%)`;
  }, []);

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

  return (
    <div className="h-[var(--titlebar-height)] bg-base border-b border-border flex items-center shrink-0 relative z-50" style={drag}>

      {/* ── 左侧: Logo 菜单 + Git 指示器 ── */}
      <div className="flex items-center shrink-0 h-full" style={noDrag}>

        {/* Logo → 点击弹出一级菜单 */}
        <div ref={menuAreaRef} className="relative h-full">
          <button
            onClick={() => { setLogoMenuOpen((v) => !v); setHoveredMenu(null); }}
            className={`flex items-center justify-center w-[46px] h-full hover:bg-white/[0.06] transition-colors ${logoMenuOpen ? "bg-white/[0.08]" : ""}`}
          >
            <PixelLogo size={2} />
          </button>

          {/* 一级菜单 */}
          {logoMenuOpen && (
            <div className="absolute top-full left-0 min-w-[160px] bg-elevated border border-border-subtle rounded-lg shadow-2xl py-1 z-[60]">
              {Object.keys(menuDefinitions).map((menuName) => (
                <div
                  key={menuName}
                  className="relative"
                  onMouseEnter={() => setHoveredMenu(menuName)}
                >
                  <div
                    className={`flex items-center justify-between px-3.5 py-2 text-[13px] font-sans cursor-default transition-colors ${
                      hoveredMenu === menuName ? "bg-white/[0.08] text-t-primary" : "text-t-secondary"
                    }`}
                  >
                    <span>{menuName}</span>
                    <ChevronRight size={12} className="text-t-ghost ml-4" />
                  </div>

                  {/* 二级子菜单 — hover 时展开 */}
                  {hoveredMenu === menuName && (
                    <div className="absolute left-full top-0 min-w-[220px] bg-elevated border border-border-subtle rounded-lg shadow-2xl py-1 -ml-0.5">
                      {menuDefinitions[menuName].map((item) => {
                        const disabled = item.enabled ? !item.enabled() : false;
                        return (
                          <button
                            key={item.label}
                            onClick={() => !disabled && handleMenuItemClick(item)}
                            disabled={disabled}
                            className={`w-full px-3.5 py-2 text-[13px] flex items-center justify-between font-sans transition-colors ${
                              disabled ? "text-t-ghost cursor-default" : "text-t-secondary hover:bg-white/[0.08] hover:text-t-primary"
                            }`}
                          >
                            <span>{item.label}</span>
                            {item.shortcut && <span className="text-[11px] text-t-ghost ml-6 font-mono">{item.shortcut}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="w-[1px] h-[14px] bg-border" />

        {/* Git 分支 */}
        {gitInfo.isGitRepo && (
          <div className="flex items-center gap-1.5 px-3 h-full text-[12px] text-t-dim font-mono">
            <GitBranch size={13} strokeWidth={1.5} />
            <span>{gitInfo.branch}</span>
            {gitInfo.changedFiles > 0 && (
              <span className="text-[11px] text-warning">↗{gitInfo.changedFiles}</span>
            )}
          </div>
        )}
      </div>

      {/* ── 中间: 项目名 + 文件名 ── */}
      <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
        <span className="text-[13px] text-t-ghost font-sans truncate">{projectName}</span>
        {fileName && (
          <>
            <span className="text-[13px] text-t-dim shrink-0">—</span>
            <span className="text-[13px] text-t-secondary font-sans truncate">{fileName}</span>
          </>
        )}
      </div>

      {/* ── 右侧: 布局切换 + 悬浮窗 + 窗口控制 ── */}
      <div className="flex items-center shrink-0 h-full gap-2" style={noDrag}>
        {/* 布局切换器（内联） */}
        <LayoutSwitcher
          panelOrder={panelOrder}
          panelVisible={panelVisible}
          onOrderChange={setPanelOrder}
          onToggleVisible={togglePanelVisible}
        />

        <div className="w-[1px] h-[14px] bg-border" />

        {/* 悬浮窗按钮组 */}
        <button
          onClick={toggleTaskPanel}
          className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors ${
            taskPanelOpen ? "text-t-primary bg-white/[0.06]" : "text-t-dim hover:bg-white/[0.06] hover:text-t-muted"
          }`}
          title="任务监控"
        >
          <ClipboardList size={14} strokeWidth={1.5} />
        </button>

        <button
          onClick={toggleAgentChat}
          className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors ${
            agentChatOpen ? "text-t-primary bg-white/[0.06]" : "text-t-dim hover:bg-white/[0.06] hover:text-t-muted"
          }`}
          title="Agent 群聊"
        >
          <MessageSquare size={14} strokeWidth={1.5} />
        </button>

        <button
          onClick={toggleTerminal}
          className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors ${
            terminalOpen ? "text-t-primary bg-white/[0.06]" : "text-t-dim hover:bg-white/[0.06] hover:text-t-muted"
          }`}
          title="终端 (Ctrl+`)"
        >
          <Terminal size={14} strokeWidth={1.5} />
        </button>

        {/* 工作区切换下拉 */}
        <div ref={workspaceMenuRef} className="relative h-full">
          <button
            onClick={() => setWorkspaceMenuOpen((v) => !v)}
            className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors ${
              workspaceMenuOpen
                ? "text-t-primary bg-white/[0.06]"
                : "text-t-dim hover:bg-white/[0.06] hover:text-t-muted"
            }`}
            title="切换工作区"
          >
            <FolderOpen size={14} strokeWidth={1.5} />
            <span className="max-w-[140px] truncate">{workspaceDisplayName}</span>
            <ChevronDown size={12} />
          </button>

          {workspaceMenuOpen && (
            <div className="absolute top-full right-0 mt-1 min-w-[320px] max-w-[420px] bg-elevated border border-border-subtle rounded-lg shadow-2xl overflow-hidden z-[70]">
              <div className="max-h-[300px] overflow-y-auto py-1">
                {recentFolders.length > 0 ? (
                  recentFolders.map((folder) => {
                    const name = folder.split(/[\\/]/).pop() || folder;
                    const active = folder === rootPath;
                    const abbrev = getWorkspaceAbbrev(folder);
                    const color = getWorkspaceColor(folder);
                    return (
                      <button
                        key={folder}
                        onClick={() => handleSelectWorkspace(folder)}
                        className={`w-full px-3.5 py-2.5 text-[12px] flex items-center text-left gap-2.5 transition-colors ${
                          active
                            ? "bg-neon/10 text-t-primary"
                            : "text-t-secondary hover:bg-white/[0.08] hover:text-t-primary"
                        }`}
                        title={`工作区: ${name}\n路径: ${folder}`}
                      >
                        <span
                          className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-[10px] font-semibold text-white"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        >
                          {abbrev}
                        </span>
                        <span className="min-w-0 flex-1 flex flex-col items-start justify-center">
                          <span className="truncate w-full text-[12px]">{name}</span>
                          <span className="truncate w-full text-[11px] text-t-ghost">
                            {folder}
                          </span>
                        </span>
                        {active && <Check size={13} className="shrink-0 text-neon" />}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3.5 py-3 text-[12px] text-t-ghost">暂无最近工作区</div>
                )}
              </div>

              <div className="border-t border-border-subtle p-1.5">
                <button
                  onClick={handleOpenFolder}
                  className="w-full px-3 py-2 rounded-md text-[12px] text-t-secondary hover:text-t-primary hover:bg-white/[0.08] transition-colors flex items-center gap-2"
                >
                  <FolderOpen size={14} />
                  <span>打开文件夹...</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-[1px] h-[14px] bg-border mx-0.5" />

        <button onClick={() => window.desktop.window.minimize()} className="w-[46px] h-full flex items-center justify-center text-t-muted hover:bg-white/[0.08] transition-colors">
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button onClick={handleMaximize} className="w-[46px] h-full flex items-center justify-center text-t-muted hover:bg-white/[0.08] transition-colors">
          {isMaximized ? <Copy size={10} strokeWidth={1.5} /> : <Square size={10} strokeWidth={1.5} />}
        </button>
        <button
          onClick={async () => {
            if (useEditor.getState().hasUnsavedChanges()) {
              setConfirmAction({ title: "未保存的更改", message: "有未保存的更改，确定要关闭吗？",
                onConfirm: () => { setConfirmAction(null); useLayout.getState().persist(); window.desktop.window.close(); },
              });
              return;
            }
            useLayout.getState().persist();
            window.desktop.window.close();
          }}
          className="w-[46px] h-full flex items-center justify-center text-t-muted hover:bg-[#c42b1c] hover:text-white transition-colors"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {confirmAction && (
        <ConfirmDialog title={confirmAction.title} message={confirmAction.message} confirmLabel="继续"
          onConfirm={confirmAction.onConfirm} onCancel={() => setConfirmAction(null)} />
      )}
    </div>
  );
}
