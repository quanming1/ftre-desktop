import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Minus, Square, X, Copy, Terminal, GitBranch, ChevronRight, MessageSquare, ClipboardList } from "lucide-react";
import { PixelLogo } from "@/components/PixelLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LayoutSwitcher } from "@/components/LayoutSwitcher";
import { Tooltip, TooltipProvider } from "@ftre/ui";
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
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const activeFile = useEditor((s) => s.activeFile);
  const rootPath = useWorkspace((s) => s.rootPath);
  const terminalOpen = useLayout((s) => s.terminalDropdownOpen);
  const toggleTerminal = useLayout((s) => s.toggleTerminalDropdown);
  const taskPanelOpen = useLayout((s) => s.taskPanelOpen);
  const toggleTaskPanel = useLayout((s) => s.toggleTaskPanel);
  const layoutMode = useLayout((s) => s.layoutMode);
  const setLayoutMode = useLayout((s) => s.setLayoutMode);
  const gitInfo = useGitService((s) => s.getInfo());

  const projectName = rootPath ? rootPath.split("/").pop() || rootPath.split("\\").pop() : "Ftre";
  const fileName = activeFile ? activeFile.split("/").pop() || activeFile.split("\\").pop() : null;

  const menuDefinitions = useMemo(() => buildMenuDefinitions(setConfirmAction), []);
  const menuAreaRef = useRef<HTMLDivElement>(null);

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

  const handleMenuItemClick = useCallback((item: MenuItem) => {
    item.action();
    setLogoMenuOpen(false);
    setHoveredMenu(null);
  }, []);

  const handleMaximize = async () => {
    await window.desktop.window.maximize();
    setIsMaximized(await window.desktop.window.isMaximized());
  };

  return (
    <div className="h-[var(--titlebar-height)] bg-elevated flex items-center shrink-0 relative z-50" style={drag}>

      {/* ── 左侧: Logo 菜单 + Git 指示器 ── */}
      <div className="flex items-center shrink-0 h-full" style={noDrag}>

        {/* Logo → 点击弹出一级菜单 */}
        <div ref={menuAreaRef} className="relative h-full">
          <button
            onClick={() => { setLogoMenuOpen((v) => !v); setHoveredMenu(null); }}
            className={`flex items-center justify-center w-[46px] h-full hover:bg-hover transition-colors ${logoMenuOpen ? "bg-active" : ""}`}
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
                      hoveredMenu === menuName ? "bg-active text-t-primary" : "text-t-secondary"
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
                              disabled ? "text-t-ghost cursor-default" : "text-t-secondary hover:bg-active hover:text-t-primary"
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
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
        />

        <div className="w-[1px] h-[14px] bg-border" />

        {/* 悬浮窗按钮组 */}
        <TooltipProvider>
          <Tooltip content="任务监控" side="bottom">
            <button
              onClick={toggleTaskPanel}
              className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors ${
                taskPanelOpen ? "text-t-primary bg-hover" : "text-t-dim hover:bg-hover hover:text-t-muted"
              }`}
            >
              <ClipboardList size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>

          <Tooltip content="终端 (Ctrl+`)" side="bottom">
            <button
              onClick={toggleTerminal}
              className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors ${
                terminalOpen ? "text-t-primary bg-hover" : "text-t-dim hover:bg-hover hover:text-t-muted"
              }`}
            >
              <Terminal size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </TooltipProvider>

        <div className="w-[1px] h-[14px] bg-border mx-0.5" />

        <button onClick={() => window.desktop.window.minimize()} className="w-[46px] h-full flex items-center justify-center text-t-muted hover:bg-active transition-colors">
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button onClick={handleMaximize} className="w-[46px] h-full flex items-center justify-center text-t-muted hover:bg-active transition-colors">
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
