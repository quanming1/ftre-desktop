import "../features/editor/monaco-setup"; // Monaco Workers 本地化（必须在最顶部）
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
