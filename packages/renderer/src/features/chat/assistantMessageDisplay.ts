import type { ContentBlock, ToolResult } from "@/stores/chat";

const DANGLING_THINK_MARKER = /^(?:<\/?(?:think|thinking)\s*>)+$/i;

/** 返回 AssistantMsg 中最后一个真正可展示的文本块。 */
export function lastDisplayTextBlock(
  blocks: ContentBlock[] | undefined,
): Extract<ContentBlock, { type: "text" }> | undefined {
  if (!blocks) return undefined;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.type !== "text") continue;
    const text = block.text.trim();
    if (!text || DANGLING_THINK_MARKER.test(text)) continue;
    return block;
  }
  return undefined;
}

/**
 * 默认只展示最终文本；完整 blocks 仍保留在 ChatMessage 中，展开执行过程时使用。
 *
 * 例外：待确认（asking）的工具调用卡片必须始终可见——否则暂停后用户看不到
 * 允许/拒绝按钮。这些 toolCall block 连同最终文本一起保留在折叠视图中。
 */
export function collapsedAssistantBlocks(
  blocks: ContentBlock[] | undefined,
  toolResults?: Record<string, ToolResult>,
): ContentBlock[] {
  const finalText = lastDisplayTextBlock(blocks);
  const askingCalls = (blocks ?? []).filter(
    (block): block is Extract<ContentBlock, { type: "toolCall" }> =>
      block.type === "toolCall" && toolResults?.[block.id]?.status === "asking",
  );
  if (askingCalls.length === 0) return finalText ? [finalText] : [];
  return finalText ? [...askingCalls, finalText] : askingCalls;
}

function processActionForTool(name: string): string {
  switch (name.trim().toLowerCase()) {
    case "think":
    case "thinking":
    case "reasoning":
      return "进行了思考";
    case "edit":
    case "edit_file":
    case "write":
    case "write_file":
      return "编辑了文件";
    case "bash":
    case "exec":
    case "shell":
      return "运行了命令";
    case "read":
    case "read_file":
      return "读取了文件";
    case "list":
    case "list_dir":
      return "查看了目录";
    case "find":
    case "glob":
    case "grep":
    case "search":
    case "semble":
      return "搜索了内容";
    case "plan":
      return "制定了计划";
    case "loadskill":
      return "加载了技能";
    case "set_workspace":
      return "切换了工作区";
    case "task":
      return "执行了子任务";
    case "cron":
      return "管理了定时任务";
    case "send_message":
      return "发送了消息";
    default:
      return "调用了工具";
  }
}

function joinProcessActions(actions: string[]): string {
  if (actions.length === 0) return "执行了操作";
  if (actions.length === 1) return actions[0];
  if (actions.length === 2) return actions.join("并");
  return `${actions.slice(0, -1).join("、")}并${actions[actions.length - 1]}`;
}

type FileChangeSummary = {
  label: string;
  additions: number;
  deletions: number;
  hasStats: boolean;
};

/** 汇总折叠组内已完成 edit/write 的文件和增删行数。 */
function summarizeFileChanges(
  blocks: ContentBlock[],
  toolResults: Record<string, ToolResult> | undefined,
): FileChangeSummary | null {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  let hasStats = false;

  for (const block of blocks) {
    if (block.type !== "toolCall") continue;
    const name = block.name.trim().toLowerCase();
    if (!["edit", "edit_file", "write", "write_file"].includes(name)) continue;
    const result = toolResults?.[block.id];
    if (result?.status !== "completed") continue;
    const metadata = result.metadata;
    if (!metadata?.file) continue;

    files.add(metadata.file.replace(/\\/g, "/").toLowerCase());
    if (typeof metadata.additions === "number") {
      additions += metadata.additions;
      hasStats = true;
    }
    if (typeof metadata.deletions === "number") {
      deletions += metadata.deletions;
      hasStats = true;
    }
  }

  if (files.size === 0) return null;
  return {
    label: `编辑了 ${files.size} 个文件`,
    additions,
    deletions,
    hasStats,
  };
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function activeToolSummary(
  block: Extract<ContentBlock, { type: "toolCall" }>,
  result: ToolResult | undefined,
): string | null {
  const name = block.name.trim().toLowerCase();
  const args = block.arguments ?? {};
  const status = result?.status;
  const isRunning = status === "running" || status === undefined;
  if (!isRunning) return null;

  if (name === "edit" || name === "edit_file" || name === "write" || name === "write_file") {
    const path = typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : result?.metadata?.file ?? "";
    return path ? `Edit ${basename(path)}` : null;
  }

  if (name === "bash" || name === "exec" || name === "shell") {
    const rawCommand = typeof args.command === "string" ? args.command : "";
    const command = rawCommand.replace(/\s+/g, " ").trim();
    return command ? `Ran ${command.slice(0, 500)}${command.length > 500 ? "…" : ""}` : null;
  }

  return null;
}

function findActiveToolSummary(
  blocks: ContentBlock[] | undefined,
  toolResults: Record<string, ToolResult> | undefined,
  streaming: boolean,
): string | null {
  if (!streaming) return null;
  for (let index = (blocks?.length ?? 0) - 1; index >= 0; index--) {
    const block = blocks?.[index];
    if (block?.type !== "toolCall") continue;
    const summary = activeToolSummary(block, toolResults?.[block.id]);
    if (summary) return summary;
  }
  return null;
}

/** 根据折叠段中的 block，生成简短且可读的过程摘要。 */
export function summarizeNonTextBlocks(
  blocks: ContentBlock[] | undefined,
  toolResults?: Record<string, ToolResult>,
  streaming = false,
): string {
  const activeSummary = findActiveToolSummary(blocks, toolResults, streaming);
  if (activeSummary) return activeSummary;

  const actions: string[] = [];
  const addAction = (action: string): void => {
    if (!actions.includes(action)) actions.push(action);
  };

  for (const block of blocks ?? []) {
    if (block.type === "thinking") {
      if (!block.thinking.trim()) continue;
      addAction("进行了思考");
      continue;
    }
    if (block.type === "toolCall") {
      if (toolResults?.[block.id]?.status === "asking") continue;
      const toolName = block.name.trim().toLowerCase();
      // MCP 工具按命名空间归类（mcp__playwright__* / mcp__figma__*）
      if (toolName.startsWith("mcp__playwright__")) {
        addAction("操作了浏览器");
      } else if (toolName.startsWith("mcp__figma__")) {
        addAction("操作了设计稿");
      } else {
        const isFileChange = [
          "edit", "edit_file", "write", "write_file",
        ].includes(toolName);
        // 先加入占位动作；循环结束后用整组文件统计替换，保持多个动作
        // 的中文连接顺序（例如“进行了思考并编辑了 2 个文件 +6 -4”）。
        addAction(isFileChange ? "编辑了文件" : processActionForTool(block.name));
      }
    }
  }

  const fileSummary = summarizeFileChanges(blocks ?? [], toolResults);
  if (fileSummary) {
    const index = actions.indexOf("编辑了文件");
    if (index >= 0) actions[index] = fileSummary.label;
    if (fileSummary.hasStats) {
      return `${joinProcessActions(actions)}（+${fileSummary.additions} -${fileSummary.deletions}）`;
    }
  }

  return joinProcessActions(actions);
}
