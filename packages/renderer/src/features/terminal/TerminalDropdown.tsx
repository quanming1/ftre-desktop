import { useEffect, useCallback, useRef } from "react";
import { TerminalSquare } from "lucide-react";
import { useLayout } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { FloatingWindow } from "@/components/FloatingWindow";
import { TerminalManager } from "./TerminalManager";
import { terminalManager } from "@/services/terminal";

/**
 * 终端浮动窗口。
 *
 * 用通用 FloatingWindow 组件包裹 TerminalManager。
 * FloatingWindow 通过 CSS display 控制显隐，TerminalManager 永远不会被 unmount。
 *
 * refit 策略（统一在此组件管理，TerminalManager 不再自行 refit）：
 * - 弹窗打开时：80ms 后 refit + focus
 * - 工作区切换且弹窗打开时：100ms 后 refit
 * - 窗口拖拽缩放/最大化/还原结束时：onResized 回调 refit
 */
export function TerminalDropdown() {
  const isOpen = useLayout((s) => s.terminalDropdownOpen);
  const toggle = useLayout((s) => s.toggleTerminalDropdown);
  const rootPath = useWorkspace((s) => s.rootPath);

  const folderName = rootPath ? rootPath.split(/[\\/]/).pop() || rootPath : "";
  const titleText = folderName ? `终端 — ${folderName}` : "终端";
  const title = (
    <span className="flex items-center gap-2">
      <TerminalSquare size={14} className="text-t-ghost shrink-0" />
      <span className="tracking-tight text-t-secondary/80">{titleText}</span>
    </span>
  );

  // 打开时 refit + focus
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      terminalManager.refitActiveTerminal();
      window.dispatchEvent(new CustomEvent("ftre:focus-terminal"));
    }, 80);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // 工作区切换后 refit（仅弹窗打开时，用 ref 跳过初次渲染）
  const prevRootPath = useRef(rootPath);
  useEffect(() => {
    if (rootPath === prevRootPath.current) return;
    prevRootPath.current = rootPath;
    if (!isOpen || !rootPath) return;
    const timer = setTimeout(() => {
      terminalManager.refitActiveTerminal();
    }, 100);
    return () => clearTimeout(timer);
  }, [rootPath, isOpen]);

  // 窗口缩放/最大化结束后 refit
  const handleResized = useCallback(() => {
    terminalManager.refitActiveTerminal();
  }, []);

  return (
    <FloatingWindow
      title={title}
      visible={isOpen}
      onClose={toggle}
      defaultRect={{ x: 160, y: 80, width: 820, height: 440 }}
      minWidth={400}
      minHeight={200}
      zIndex={45}
      onResized={handleResized}
    >
      <TerminalManager />
    </FloatingWindow>
  );
}
