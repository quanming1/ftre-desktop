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

// Worker 实例缓存，避免重复创建
const workerCache = new Map<string, Worker>();

function getOrCreateWorker(label: string): Worker {
  const cached = workerCache.get(label);
  if (cached) return cached;

  let worker: Worker;
  if (label === "typescript" || label === "javascript") {
    worker = new tsWorker();
  } else if (label === "json") {
    worker = new jsonWorker();
  } else if (label === "css" || label === "scss" || label === "less") {
    worker = new cssWorker();
  } else if (label === "html" || label === "handlebars" || label === "razor") {
    worker = new htmlWorker();
  } else {
    worker = new editorWorker();
  }

  workerCache.set(label, worker);
  return worker;
}

self.MonacoEnvironment = {
  getWorker(_, label) {
    return getOrCreateWorker(label);
  },
};

// 告诉 @monaco-editor/react 使用本地 Monaco，不从 CDN 加载
loader.config({ monaco });

// ── 预热相关 ──

let prewarmed = false;

/**
 * 预热 Monaco Editor（在应用空闲时调用）
 *
 * 预创建最常用的 Workers，避免首次打开文件时的延迟：
 * - TypeScript Worker (~1-2MB，最重)
 * - Editor Worker (基础编辑功能)
 *
 * 建议在 requestIdleCallback 或用户悬停文件树时调用。
 */
export function prewarmMonaco(): void {
  if (prewarmed) return;
  prewarmed = true;

  // 使用 requestIdleCallback 在浏览器空闲时预热
  const prewarmTask = () => {
    // 预创建 TypeScript Worker（最耗时）
    getOrCreateWorker("typescript");
    // 预创建基础 Editor Worker
    getOrCreateWorker("editor");
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(prewarmTask, { timeout: 3000 });
  } else {
    // Fallback: 延迟 1 秒后执行
    setTimeout(prewarmTask, 1000);
  }
}

/**
 * 检查是否已预热
 */
export function isMonacoPrewarmed(): boolean {
  return prewarmed;
}

/**
 * 获取已缓存的 Worker 数量（用于调试/性能监控）
 */
export function getWorkerCacheSize(): number {
  return workerCache.size;
}
