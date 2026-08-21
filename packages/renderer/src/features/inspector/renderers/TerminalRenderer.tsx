/**
 * TerminalRenderer — Inspector 中的终端页面。
 *
 * 终端 PTY 和 xterm 生命周期仍由 TerminalManager 统一管理；这里仅提供
 * Inspector 内容区的嵌入布局，避免再创建一套终端实现。
 */
import type { TabRendererProps } from "../tabRegistry";
import { TerminalManager } from "@/features/terminal/TerminalManager";

export function TerminalRenderer({ tab, active }: TabRendererProps) {
  if (tab.type !== "terminal") return null;

  return (
    <div className="h-full w-full overflow-hidden bg-base">
      <TerminalManager embedded active={active} terminalId={tab.terminalId} />
    </div>
  );
}
