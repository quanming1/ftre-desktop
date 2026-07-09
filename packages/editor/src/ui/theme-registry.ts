/**
 * Monaco 主题注册
 *
 * 从 themes 模块读取主题配置并注册到 Monaco。
 * 每次调用都重新 defineTheme（Monaco 内部幂等），确保 HMR 下主题变更即时生效。
 *
 * ensureAllThemesRegistered: 通过 @monaco-editor/loader 在 Monaco 初始化后
 * 立即注册所有自定义主题，确保 @monaco-editor/react 的 setTheme("ftre-light")
 * 不会因主题未注册而回退到默认 vs 主题（导致 diff 颜色不一致）。
 */

import type * as Monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { getTheme, getAvailableThemes } from "./themes";

export function registerFtreTheme(
  monaco: typeof Monaco,
  themeId?: string,
): void {
  const theme = getTheme(themeId);

  const cssOverrides: Record<string, string> = {
    "editor.background": "#ffffff",
  };

  monaco.editor.defineTheme(theme.id, {
    base: theme.base,
    inherit: theme.inherit,
    rules: theme.tokenRules.map((r) => ({
      token: r.token,
      foreground: r.foreground,
      fontStyle: r.fontStyle,
    })),
    colors: { ...theme.editorColors, ...cssOverrides },
  });
}

let preRegistered = false;

/**
 * 在 Monaco 初始化后、任何 editor 创建前注册所有自定义主题。
 * 幂等，多次调用安全。
 */
export function ensureAllThemesRegistered(): void {
  if (preRegistered || typeof window === "undefined") return;
  preRegistered = true;

  loader.init().then((monaco) => {
    for (const { id } of getAvailableThemes()) {
      registerFtreTheme(monaco as typeof Monaco, id);
    }
  }).catch(() => {
    // loader 尚未配置或 Monaco 未加载，忽略
    preRegistered = false;
  });
}

// 模块加载时立即触发
ensureAllThemesRegistered();
