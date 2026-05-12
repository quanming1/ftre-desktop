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
import { getTextModelResolverService } from "@ftre/editor/workbench";
import { registerFtreTheme, getActiveThemeId } from "@ftre/editor/ui";
import { initEditorHostBridge } from "../features/editor/editor-host-bridge";
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary, TooltipProvider } from "@ftre/ui";
import { App } from "./App";
import "../styles/tailwind.css";
import "../styles/reset.css";
import "../styles/global.css";
import "../styles/markdown.css";
import "highlight.js/styles/github-dark.min.css";
import "@ftre/ui/styles.css";
import "overlayscrollbars/styles/overlayscrollbars.css";
import "sonner/dist/styles.css";

// 初始化编辑器 host bridge
initEditorHostBridge();

// ── WebSocket 连接初始化 ──
import { initConnection } from "@/services/api";
import { wsClient } from "@/services/websocket-client";
import { useChat } from "@/stores/chat";

// Register handlers BEFORE connection to avoid race condition
wsClient.onConnect(() => useChat.getState().setConnected(true));
wsClient.onDisconnect(() => useChat.getState().setConnected(false));
wsClient.onStatusChange((status) => useChat.getState().setWsStatus(status));

// Load saved gateway URL then connect
(async () => {
  if (window.desktop?.store) {
    const { value } = await window.desktop.store.get("gatewayUrl");
    if (typeof value === "string" && value) {
      wsClient.setUrl(value);
    }
  }
  initConnection();
})();

// 初始化编辑器架构（必须在 Monaco Workers 配置之后、渲染之前）
const textModelService = getTextModelResolverService();
textModelService.init(monaco);

// 预注册主题（在编辑器创建前完成，避免首帧白色闪烁）
registerFtreTheme(monaco);
monaco.editor.setTheme(getActiveThemeId());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <ErrorBoundary level="app">
        <App />
      </ErrorBoundary>
    </TooltipProvider>
  </React.StrictMode>,
);
