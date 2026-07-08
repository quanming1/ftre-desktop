/**
 * Monaco 主题注册
 *
 * 从 themes 模块读取主题配置并注册到 Monaco。
 * 每次调用都重新 defineTheme（Monaco 内部幂等），确保 HMR 下主题变更即时生效。
 */

import type * as Monaco from "monaco-editor";
import { getTheme } from "./themes";

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

/**
 * Reset theme registration state (for testing).
 *
 * registerFtreTheme has no side-effect state (defineTheme is idempotent),
 * this function is a no-op kept for test mock and export contract compatibility.
 */
export function _resetThemeRegistration(): void {
  // no-op: defineTheme is idempotent, nothing to reset
}
