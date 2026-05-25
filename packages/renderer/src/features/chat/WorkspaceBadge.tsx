/**
 * WorkspaceBadge — 输入框工具栏左侧的"当前工作区"徽章
 *
 * 数据来源：扫描当前 session 的 messages，找最近一次成功的 set_workspace
 * 工具调用（result 不以 [error] 开头），从 result 字符串解析新路径。
 *
 * 交互：
 * - 显示路径最后一段文件夹名（紧凑）
 * - hover 显示完整路径 tooltip + "在资源管理器中打开" 操作按钮
 * - 点击徽章本体复制完整路径到剪贴板
 *
 * 没找到时不渲染。
 */
import { useMemo, useState, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { useChat } from "@/stores/chat";
import { Tooltip } from "@ftre/ui";
import { useNotification } from "@/stores/notification";

/** 解析 set_workspace 工具的 result 字符串 */
function parseSetWorkspaceResult(result: string): string | null {
  if (!result || typeof result !== "string") return null;
  const arrowIdx = result.indexOf("→");
  if (arrowIdx >= 0) {
    return result.slice(arrowIdx + 1).trim() || null;
  }
  const prefix = "工作区未变化:";
  if (result.startsWith(prefix)) {
    return result.slice(prefix.length).trim() || null;
  }
  return null;
}

function deriveWorkspace(
  messages: Array<{
    toolCalls?: Array<{ name: string; status: string; result?: string }>;
  }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tcs = messages[i].toolCalls;
    if (!tcs) continue;
    for (let j = tcs.length - 1; j >= 0; j--) {
      const tc = tcs[j];
      if (tc.name !== "set_workspace") continue;
      if (tc.status === "error") continue;
      const result = tc.result || "";
      if (result.startsWith("[error]")) continue;
      const cwd = parseSetWorkspaceResult(result);
      if (cwd) return cwd;
    }
  }
  return null;
}

/** 取路径最后一段：D:\proj\src\ftre → ftre */
function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return path;
  return parts[parts.length - 1];
}

export function WorkspaceBadge() {
  const messages = useChat((s) => s.messages);
  const workspace = useMemo(() => deriveWorkspace(messages), [messages]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!workspace) return;
    try {
      await navigator.clipboard.writeText(workspace);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      useNotification.getState().addNotification({
        level: "error",
        message: "复制失败",
      });
    }
  }, [workspace]);

  const handleReveal = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!workspace) return;
      try {
        window.desktop?.fs?.revealInExplorer(workspace);
      } catch (err) {
        useNotification.getState().addNotification({
          level: "error",
          message: "无法打开资源管理器",
        });
      }
    },
    [workspace],
  );

  if (!workspace) return null;

  const name = basename(workspace);

  const tooltip = (
    <div className="flex flex-col gap-1 min-w-[200px]">
      <div className="text-[10.5px] uppercase tracking-wider text-t-ghost">
        工作区
      </div>
      <div className="font-mono text-[11.5px] text-t-secondary break-all leading-snug">
        {workspace}
      </div>
      <div className="text-[10.5px] text-t-ghost mt-1">
        {copied ? "✓ 已复制" : "点击复制路径"}
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltip} side="top">
      <div className="group relative flex items-center h-8 rounded-md hover:bg-hover transition-colors">
        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center h-8 px-2 text-[12px] font-mono transition-colors ${
            copied
              ? "text-green-500"
              : "text-t-secondary hover:text-t-primary"
          }`}
        >
          <span className="truncate max-w-[140px]">
            {copied ? "✓ 已复制" : name}
          </span>
        </button>

        {/* hover 时出现的操作按钮 */}
        <button
          type="button"
          onClick={handleReveal}
          title="在资源管理器中打开"
          aria-label="在资源管理器中打开"
          className="ml-0.5 mr-1 h-5 w-5 flex items-center justify-center rounded text-t-ghost opacity-0 group-hover:opacity-100 hover:text-t-primary hover:bg-elevated transition-all"
        >
          <ExternalLink size={11} />
        </button>
      </div>
    </Tooltip>
  );
}
