import { useState, useCallback } from "react";
import { Terminal, AlertTriangle, FileOutput, X, Maximize2, Minimize2 } from "lucide-react";
import { useLayout, BOTTOM_PANEL_HEIGHT_MAX, type BottomTab } from "@/stores/layout";
import { TerminalManager } from "@/features/terminal/TerminalManager";
import { ProblemsPanel } from "@/features/bottom-panel/ProblemsPanel";
import { OutputPanel } from "@/features/bottom-panel/OutputPanel";
import type { LucideIcon } from "lucide-react";

interface TabDef {
  id: BottomTab;
  icon: LucideIcon;
  label: string;
}

const tabs: TabDef[] = [
  { id: "terminal", icon: Terminal, label: "终端" },
  { id: "problems", icon: AlertTriangle, label: "问题" },
  { id: "output", icon: FileOutput, label: "输出" },
];

const DEFAULT_HEIGHT = 200;

export function BottomPanel() {
  const activeBottomTab = useLayout((s) => s.activeBottomTab);
  const setActiveBottomTab = useLayout((s) => s.setActiveBottomTab);
  const toggleBottomPanel = useLayout((s) => s.toggleBottomPanel);
  const bottomPanelHeight = useLayout((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useLayout((s) => s.setBottomPanelHeight);

  const [isMaximized, setIsMaximized] = useState(false);

  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      setBottomPanelHeight(DEFAULT_HEIGHT);
      setIsMaximized(false);
    } else {
      setBottomPanelHeight(BOTTOM_PANEL_HEIGHT_MAX);
      setIsMaximized(true);
    }
  }, [isMaximized, setBottomPanelHeight]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Only toggle on double-click of the tab bar itself, not buttons
      if ((e.target as HTMLElement).closest("button")) return;
      handleToggleMaximize();
    },
    [handleToggleMaximize],
  );

  return (
    <div className="flex flex-col bg-surface border-t border-border" style={{ height: bottomPanelHeight }}>
      {/* Tab bar */}
      <div className="flex items-center justify-between h-10 px-2.5 border-b border-border shrink-0 select-none" onDoubleClick={handleDoubleClick}>
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeBottomTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveBottomTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-md transition-colors duration-150 ${
                  isActive ? "text-t-primary bg-white/[0.06]" : "text-t-ghost hover:text-t-muted hover:bg-white/[0.04]"
                }`}
              >
                <tab.icon size={15} strokeWidth={1.5} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleToggleMaximize}
            title={isMaximized ? "还原" : "最大化"}
            aria-label={isMaximized ? "还原面板" : "最大化面板"}
            className="p-1.5 text-t-ghost hover:text-t-muted rounded-md transition-colors duration-150 hover:bg-white/[0.06]"
          >
            {isMaximized ? <Minimize2 size={15} strokeWidth={1.5} /> : <Maximize2 size={15} strokeWidth={1.5} />}
          </button>
          <button
            onClick={toggleBottomPanel}
            title="关闭面板"
            aria-label="关闭面板"
            className="p-1.5 text-t-ghost hover:text-t-muted rounded-md transition-colors duration-150 hover:bg-white/[0.06]"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Content area — TerminalManager always mounted, CSS hidden to preserve sessions (BUG 3 fix) */}
      <div className="flex-1 overflow-hidden text-sm text-t-muted relative">
        <div className="absolute inset-0" style={{ display: activeBottomTab === "terminal" ? "block" : "none" }}>
          <TerminalManager />
        </div>
        {activeBottomTab === "problems" && (
          <div className="absolute inset-0">
            <ProblemsPanel />
          </div>
        )}
        {activeBottomTab === "output" && (
          <div className="absolute inset-0">
            <OutputPanel />
          </div>
        )}
      </div>
    </div>
  );
}
