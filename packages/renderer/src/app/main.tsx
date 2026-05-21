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
import { registerFtreTheme, getThemeIdForMode } from "@ftre/editor/ui";
import { initEditorHostBridge } from "../features/editor/editor-host-bridge";
import { setHljsTheme } from "@/lib/hljs-theme-loader";
import { useTheme } from "@/stores/theme";
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary, TooltipProvider } from "@ftre/ui";
import { App } from "./App";
import "../styles/tokens.css";
import "../styles/tailwind.css";
import "../styles/reset.css";
import "../styles/global.css";
import "../styles/markdown.css";

import "@ftre/ui/styles.css";
import "overlayscrollbars/styles/overlayscrollbars.css";
import "sonner/dist/styles.css";

// 初始化编辑器 host bridge
initEditorHostBridge();

// ── WebSocket 连接初始化 ──
import { initConnection } from "@/services/api";
import { wsClient } from "@/services/websocket-client";

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

// 初始化 Theme Manager → 注册 Monaco 主题 → 渲染
(async () => {
  // 1. 确认/修正 mode（从 IPC store 读取持久化值）
  await useTheme.getState().init();

  // 2. 使用 resolvedMode 获取正确的 Monaco 主题 id
  const resolvedMode = useTheme.getState().resolvedMode;
  const themeId = getThemeIdForMode(resolvedMode);

  // 3. 注册并激活 Monaco 主题
  registerFtreTheme(monaco, themeId);
  monaco.editor.setTheme(themeId);

  // 4. 设置 highlight.js 主题
  setHljsTheme(resolvedMode);

  // 5. 订阅后续 resolvedMode 变化，同步 Monaco 与 highlight.js
  useTheme.subscribe((state, prev) => {
    if (state.resolvedMode !== prev.resolvedMode) {
      const newThemeId = getThemeIdForMode(state.resolvedMode);
      registerFtreTheme(monaco, newThemeId);
      monaco.editor.setTheme(newThemeId);
      setHljsTheme(state.resolvedMode);
    }
  });

  // 6. React 渲染
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <TooltipProvider>
        <ErrorBoundary level="app">
          <App />
        </ErrorBoundary>
      </TooltipProvider>
    </React.StrictMode>,
  );
})();
