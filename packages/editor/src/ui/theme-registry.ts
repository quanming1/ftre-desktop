/**
 * Monaco 主题注册
 *
 * 从 themes 模块读取主题配置并注册到 Monaco。
 * 部分编辑器颜色仍从 CSS 变量读取，确保与应用外壳保持一致。
 */

import type * as Monaco from "monaco-editor";
import { getTheme } from "./themes";

let registeredThemeId: string | null = null;

export function registerFtreTheme(
  monaco: typeof Monaco,
  themeId?: string,
): void {
  const theme = getTheme(themeId);
  if (registeredThemeId === theme.id) return;

  const style = getComputedStyle(document.documentElement);
  const cssVar = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  const cssOverrides: Record<string, string> = {
    "editor.background": cssVar("--color-base", "#1e1e1e"),
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

  registeredThemeId = theme.id;
}

/** Reset registration state — exposed only for testing. */
export function _resetThemeRegistration(): void {
  registeredThemeId = null;
}
