/**
 * 编辑器命令式操作函数。
 * 协调 editorCore（非响应式内容管理）和 editor store（响应式元数据）。
 */

import { editorCore } from './editor-core';
import { useEditor } from '@/stores/editor';
import { useNotification } from '@/stores/notification';

/** 打开文件：内容注入 editorCore，元数据注入 store */
export function openFileWithContent(
  meta: { path: string; name: string; language: string },
  content: string,
): void {
  editorCore.setContent(meta.path, content);
  editorCore.setDiskContent(meta.path, content);
  useEditor.getState().openFile({ ...meta, content });
}

/** 刷新文件内容（外部文件变更/SSE 触发）*/
export function refreshFileContent(path: string, newContent: string): void {
  editorCore.setContent(path, newContent);
  editorCore.setDiskContent(path, newContent);
  editorCore.pushContentToEditor(path, newContent);
  useEditor.getState().markSaved(path);
}

/** 关闭文件：清理 editorCore + store */
export function closeFileAndCleanup(path: string): void {
  useEditor.getState().closeFile(path);
  editorCore.removeContent(path);
  editorCore.removeViewState(path);
}

/** 获取文件内容供保存 */
export function getFileContentForSave(path: string): string {
  return editorCore.resolveContent(path);
}

/** 根据文件扩展名推断语言 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
  html: 'html', css: 'css', scss: 'scss', sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', xml: 'xml', svg: 'xml',
  c: 'c', cpp: 'cpp', h: 'c', txt: 'plaintext', log: 'plaintext',
  env: 'plaintext', gitignore: 'plaintext', dockerfile: 'dockerfile',
};

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}

/**
 * 保存文件到磁盘（统一入口）。
 * 处理普通文件 + untitled 另存为两种场景。
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
  // untitled 文件另存为
  if (filePath.startsWith('untitled:')) {
    const saveResult = await window.desktop.fs.showSaveDialog({ defaultName: fileName });
    if (!saveResult?.path) return;
    const content = getContent();
    const writeResult = await window.desktop.fs.writeFile(saveResult.path, content);
    if (writeResult.success) {
      const name = saveResult.path.split(/[\\/]/).pop() ?? saveResult.path;
      useEditor.getState().closeFile(filePath);
      editorCore.setContent(saveResult.path, content);
      editorCore.setDiskContent(saveResult.path, content);
      useEditor.getState().openFile({
        path: saveResult.path,
        name,
        language: inferLanguage(saveResult.path),
        content,
      });
    } else {
      useNotification.getState().addNotification({ level: 'error', message: writeResult.error || '保存文件失败' });
    }
    return;
  }

  // 普通文件保存
  const content = getContent();
  const result = await window.desktop.fs.writeFile(filePath, content);
  if (result.success) {
    editorCore.setDiskContent(filePath, content);
    onDirtyReset?.();
    useEditor.getState().markSaved(filePath);
  } else {
    useNotification.getState().addNotification({ level: 'error', message: result.error || '保存文件失败' });
  }
}
