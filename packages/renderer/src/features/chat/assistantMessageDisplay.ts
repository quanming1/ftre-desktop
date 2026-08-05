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

/** 根据折叠段中的 block，生成简短且可读的过程摘要。 */
export function summarizeNonTextBlocks(
  blocks: ContentBlock[] | undefined,
  toolResults?: Record<string, ToolResult>,
): string {
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
        addAction(processActionForTool(block.name));
      }
    }
  }

  return joinProcessActions(actions);
}
