/**
 * Monaco 主题注册
 *
 * 从 themes 模块读取主题配置并注册到 Monaco。
 * 部分编辑器颜色仍从 CSS 变量读取，确保与应用外壳保持一致。
 */

import type * as Monaco from "monaco-editor";
import { getTheme } from "./themes";

/** 已注册的主题 ID 集合（支持多主题共存） */
const registeredThemeIds = new Set<string>();

export function registerFtreTheme(
  monaco: typeof Monaco,
  themeId?: string,
): void {
  const theme = getTheme(themeId);
  if (registeredThemeIds.has(theme.id)) return;

  const style = getComputedStyle(document.documentElement);
  const cssVar = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

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

  registeredThemeIds.add(theme.id);
}

/** Reset registration state — exposed only for testing. */
export function _resetThemeRegistration(): void {
  registeredThemeIds.clear();
}
