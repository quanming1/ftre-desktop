import type { ToolCallMessage } from "@/types/chat";
import { useEditor, buildDiffId, buildDiffTabPath } from "@/stores/editor";
import { useNotification } from "@/stores/notification";
import { resolveFilePath, basename } from "@/utils/pathUtils";
import { getToolFilePath } from "./toolClassification";
import { fetchDiff } from "@/services/api";

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  py: "python",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  vue: "vue",
  scss: "scss",
  less: "less",
  xml: "xml",
  sql: "sql",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  toml: "toml",
  ini: "ini",
  env: "dotenv",
};

function guessLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG_MAP[ext] ?? "plaintext";
}

/**
 * 通过 IPC 读取文件并在编辑器中打开（read/write Tool）。
 */
export async function handleOpenFile(filePath: string): Promise<void> {
  const fullPath = resolveFilePath(filePath);
  try {
    const result = await window.desktop.fs.readFile(fullPath);
    if (result.error) return;
    useEditor.getState().openFile({
      path: fullPath,
      name: basename(fullPath),
      language: result.language,
      content: result.content,
    });
  } catch {
    // 静默忽略
  }
}

/**
 * 打开文件并跳转到指定行（代码引用点击跳转）。
 */
export async function handleOpenFileAtLine(
  filePath: string,
  line: number,
  col?: number,
): Promise<void> {
  const fullPath = resolveFilePath(filePath);
  try {
    const result = await window.desktop.fs.readFile(fullPath);
    if (result.error) return;
    useEditor.getState().openFile({
      path: fullPath,
      name: basename(fullPath),
      language: result.language,
      content: result.content,
    });
    // Give the editor a tick to mount/activate, then jump to line
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("ftre:reveal-line", {
          detail: { filePath: fullPath, line, col: col ?? 1 },
        }),
      );
    });
  } catch {
    // 静默忽略
  }
}

/**
 * 显示 edit/write 工具的 diff。
 * 优先从后端获取影子 git 快照 diff，回退时基于文件内容构造。
 */
export async function handleShowDiff(message: ToolCallMessage): Promise<void> {
  const store = useEditor.getState();
  const callId = message.toolId;

  // 1. 从后端影子 git 获取 diff
  const diffData = await fetchDiff(callId);

  if (diffData && diffData.files.length > 0) {
    // 取第一个变更文件（edit 通常只改一个文件）
    const fileDiff = diffData.files[0];
    const fullPath = resolveFilePath(fileDiff.file);
    const diffId = buildDiffId(callId, fullPath);

    const existing = store.pendingDiffs.find((d) => d.id === diffId);
    if (existing) {
      activateExistingDiff(diffId);
      return;
    }

    const diffTabPath = buildDiffTabPath(fullPath);
    store.openFile({
      path: diffTabPath,
      name: `${basename(fullPath)} (Diff)`,
      language: guessLanguage(fullPath),
      content: fileDiff.after_content,
    });
    store.addDiff({
      id: diffId,
      filePath: fullPath,
      tabPath: diffTabPath,
      originalContent: fileDiff.before_content,
      newContent: fileDiff.after_content,
      toolName: diffData.tool_name,
      isApproximate: false,
    });
    return;
  }

  // 2. 回退：基于当前文件内容和参数构造
  const filePath = getToolFilePath(message);
  const oldString = message.arguments?.oldString as string;
  const newString = message.arguments?.newString as string;
  if (
    !filePath ||
    typeof oldString !== "string" ||
    typeof newString !== "string"
  )
    return;

  const fullPath = resolveFilePath(filePath);
  const diffId = buildDiffId(callId, fullPath);

  const existingFallback = store.pendingDiffs.find((d) => d.id === diffId);
  if (existingFallback) {
    activateExistingDiff(diffId);
    return;
  }

  try {
    const result = await window.desktop.fs.readFile(fullPath);
    if (result.error) {
      useNotification.getState().addNotification({
        level: "error",
        message: `无法读取文件: ${filePath}`,
      });
      return;
    }

    const replaceAll = message.arguments?.replaceAll === true;
    const currentContent = result.content;
    let originalContent: string;
    let newContent: string;

    if (currentContent.includes(oldString)) {
      originalContent = currentContent;
      newContent = replaceAll
        ? currentContent.split(oldString).join(newString)
        : currentContent.replace(oldString, newString);
    } else if (currentContent.includes(newString)) {
      originalContent = replaceAll
        ? currentContent.split(newString).join(oldString)
        : currentContent.replace(newString, oldString);
      newContent = currentContent;
    } else {
      useNotification.getState().addNotification({
        level: "error",
        message: "无法构造差异视图：未在文件中找到匹配的原始内容",
      });
      return;
    }

    const diffTabPath = buildDiffTabPath(fullPath);
    store.openFile({
      path: diffTabPath,
      name: `${basename(fullPath)} (Diff)`,
      language: result.language,
      content: currentContent,
    });
    store.addDiff({
      id: diffId,
      filePath: fullPath,
      tabPath: diffTabPath,
      originalContent,
      newContent,
      toolName: "edit",
      isApproximate: true,
    });
  } catch (err) {
    useNotification.getState().addNotification({
      level: "error",
      message: `显示差异时发生异常: ${filePath}`,
    });
  }
}

/**
 * 激活已存在的 DiffEntry。
 */
export function activateExistingDiff(diffId: string): void {
  const store = useEditor.getState();
  const diff = store.pendingDiffs.find((d) => d.id === diffId);
  if (!diff) return;

  store.openFile({
    path: diff.tabPath,
    name: `${basename(diff.filePath)} (Diff)`,
    language: guessLanguage(diff.filePath),
    content: diff.newContent,
  });
  store.setActive(diff.tabPath);
}

// ═══════════════════════════════════════════════════════════════════════
// 内联 Diff 数据获取（不打开编辑器 tab，仅返回 before/after 内容）
// ═══════════════════════════════════════════════════════════════════════

export interface InlineDiffResult {
  fileName: string;
  before: string;
  after: string;
}

/**
 * 获取 edit 工具的 diff 数据用于内联展示。
 * 优先从后端影子 git 快照获取，回退时基于参数 + 文件内容推断。
 */
export async function fetchDiffForInline(
  message: ToolCallMessage,
): Promise<InlineDiffResult | null> {
  const callId = message.toolId;

  // 1. 从后端影子 git 获取精确 diff
  const diffData = await fetchDiff(callId);
  if (diffData && diffData.files.length > 0) {
    const fileDiff = diffData.files[0];
    return {
      fileName: basename(fileDiff.file),
      before: fileDiff.before_content,
      after: fileDiff.after_content,
    };
  }

  // 2. 回退：从参数 + 当前文件内容推断
  const filePath = getToolFilePath(message);
  const oldString = message.arguments?.oldString as string;
  const newString = message.arguments?.newString as string;
  if (
    !filePath ||
    typeof oldString !== "string" ||
    typeof newString !== "string"
  )
    return null;

  const fullPath = resolveFilePath(filePath);
  try {
    const result = await window.desktop.fs.readFile(fullPath);
    if (result.error) return null;

    const replaceAll = message.arguments?.replaceAll === true;
    const currentContent = result.content;
    let originalContent: string;
    let newContent: string;

    if (currentContent.includes(oldString)) {
      originalContent = currentContent;
      newContent = replaceAll
        ? currentContent.split(oldString).join(newString)
        : currentContent.replace(oldString, newString);
    } else if (currentContent.includes(newString)) {
      originalContent = replaceAll
        ? currentContent.split(newString).join(oldString)
        : currentContent.replace(newString, oldString);
      newContent = currentContent;
    } else {
      return null;
    }

    return {
      fileName: basename(fullPath),
      before: originalContent,
      after: newContent,
    };
  } catch {
    return null;
  }
}
