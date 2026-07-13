/**
 * Monaco Editor Workers 本地化配置 + 预热优化。
 *
 * @monaco-editor/react 默认从 jsDelivr CDN 加载 Monaco 本体和 Workers。
 * 在 Electron 桌面端这会导致：
 * - 离线时编辑器完全不可用
 * - 在线时每次打开都要等网络请求
 * - Workers 加载延迟导致语法高亮/自动补全卡顿
 *
 * 本文件配置 Vite worker import + loader.config，让一切从本地 bundle 加载。
 * 在 main.tsx 最顶部 import 此文件。
 *
 * 预热策略：
 * - 应用启动后空闲时预创建 TypeScript Worker（最重的 Worker）
 * - 用户悬停文件树时提前初始化 Monaco Editor 核心
 */

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

// Worker 实例缓存已移除：Monaco 0.55 的 EditorWorkerClient 有自己的 worker 生命周期管理
// （STOP_WORKER_DELTA_TIME_MS 空闲后 dispose）。如果这里缓存 Worker 实例返回同一个 Worker，
// 多个 diff editor 会共享同一个 worker proxy，导致 computeDiff 消息路由混乱，
// 部分 diff editor 永远收不到结果 → onDidUpdateDiff 不触发 → diff 行不显示（偶现根因）。

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    } else if (label === "json") {
      return new jsonWorker();
    } else if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    } else if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    } else {
      return new editorWorker();
    }
  },
};

// 告诉 @monaco-editor/react 使用本地 Monaco，不从 CDN 加载
loader.config({ monaco });

// ── 预热相关 ──

let prewarmed = false;

/**
 * 预热 Monaco Editor（在应用空闲时调用）
 *
 * 创建一个临时的 TypeScript Worker 让 Vite 预先编译 worker bundle，
 * 避免首次打开文件时的延迟。Worker 创建后即丢弃，不影响后续使用。
 */
export function prewarmMonaco(): void {
  if (prewarmed) return;
  prewarmed = true;

  const prewarmTask = () => {
    // 预编译 TypeScript Worker bundle（创建后立即 terminate）
    const w = new tsWorker();
    w.terminate();
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(prewarmTask, { timeout: 3000 });
  } else {
    setTimeout(prewarmTask, 1000);
  }
}

/**
 * 检查是否已预热
 */
export function isMonacoPrewarmed(): boolean {
  return prewarmed;
}
