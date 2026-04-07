import "../features/editor/monaco-setup"; // Monaco Workers 本地化（必须在最顶部）

// 全局错误处理：抑制 Monaco DiffEditor 在卸载时的已知错误
// 这是 @monaco-editor/react 的已知问题，错误本身不影响功能
const originalError = window.onerror;
window.onerror = (message, source, lineno, colno, error) => {
  if (
    typeof message === "string" &&
    message.includes(
      "TextModel got disposed before DiffEditorWidget model got reset",
    )
  ) {
    // 抑制这个特定错误，返回 true 表示已处理
    return true;
  }
  if (originalError) {
    return originalError(message, source, lineno, colno, error);
  }
  return false;
};

// 同时处理 unhandledrejection 和 error 事件
window.addEventListener("error", (event) => {
  if (
    event.error?.message?.includes(
      "TextModel got disposed before DiffEditorWidget model got reset",
    )
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
});

import * as monaco from "monaco-editor";
import { getDocumentManager, getSlotPool } from "@ftre/editor/core";
import { registerFtreTheme, getActiveThemeId } from "@ftre/editor/ui";
import { initEditorHostBridge } from "../features/editor/editor-host-bridge";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../styles/tailwind.css";
import "../styles/reset.css";
import "../styles/global.css";
import "../styles/markdown.css";
import "highlight.js/styles/github-dark.min.css";
import "@ftre/ui/styles.css";

// 初始化编辑器 host bridge
initEditorHostBridge();

// 初始化编辑器架构（必须在 Monaco Workers 配置之后、渲染之前）
const docManager = getDocumentManager();
const slotPool = getSlotPool();
docManager.init(monaco);
slotPool.init(monaco);

// 预注册主题（在编辑器创建前完成，避免首帧白色闪烁）
registerFtreTheme(monaco);
monaco.editor.setTheme(getActiveThemeId());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
