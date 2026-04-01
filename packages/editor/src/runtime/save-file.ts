/**
 * 保存文件到磁盘（统一入口）。
 * 处理普通文件 + untitled 另存为两种场景。
 */

import { editorCore } from "../core/editor-core";
import { getHostBridge } from "./host-bridge";

/** 根据文件扩展名推断语言 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  xml: "xml",
  svg: "xml",
  c: "c",
  cpp: "cpp",
  h: "c",
  txt: "plaintext",
  log: "plaintext",
  env: "plaintext",
  gitignore: "plaintext",
  dockerfile: "dockerfile",
};

function inferLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] || "plaintext";
}

/**
 * 保存文件到磁盘。
 *
 * @param filePath 当前文件路径
 * @param fileName 文件名（用于 untitled 另存为的默认名）
 * @param getContent 获取当前编辑器内容的函数
 * @param onDirtyReset 可选回调，在保存成功后调用（用于重置组件级 dirty ref）
 */
export async function saveFile(
  filePath: string,
  fileName: string,
  getContent: () => string,
  onDirtyReset?: () => void,
): Promise<void> {
  const host = getHostBridge();

  // untitled 文件另存为
  if (filePath.startsWith("untitled:")) {
    const saveResult = await host.showSaveDialog({ defaultName: fileName });
    if (!saveResult?.path) return;

    const content = getContent();
    const writeResult = await host.writeFile(saveResult.path, content);

    if (writeResult.success) {
      const name = saveResult.path.split(/[\\/]/).pop() ?? saveResult.path;
      host.closeFile(filePath);
      editorCore.setContent(saveResult.path, content);
      editorCore.setDiskContent(saveResult.path, content);
      host.openFile({
        path: saveResult.path,
        name,
        language: inferLanguage(saveResult.path),
        content,
      });
    } else {
      host.notifyError(writeResult.error || "保存文件失败");
    }
    return;
  }

  // 普通文件保存
  const content = getContent();
  const result = await host.writeFile(filePath, content);

  if (result.success) {
    editorCore.setDiskContent(filePath, content);
    onDirtyReset?.();
    host.markSaved(filePath);
  } else {
    host.notifyError(result.error || "保存文件失败");
  }
}
