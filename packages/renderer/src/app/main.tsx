import "../features/editor/monaco-setup"; // Monaco Workers 本地化（必须在最顶部）
import * as monaco from "monaco-editor";
import { editorManager } from "@ftre/editor/core";
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

// 初始化编辑器 host bridge
initEditorHostBridge();

// 初始化 EditorManager 实例池（必须在 Monaco Workers 配置之后、渲染之前）
editorManager.init(monaco);

// 预注册主题（在编辑器创建前完成，避免首帧白色闪烁）
registerFtreTheme(monaco);
monaco.editor.setTheme(getActiveThemeId());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
