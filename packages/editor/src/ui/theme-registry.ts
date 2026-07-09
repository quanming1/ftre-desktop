/**
 * Monaco 主题注册
 *
 * 从 themes 模块读取主题配置并注册到 Monaco。
 * 每次调用都重新 defineTheme（Monaco 内部幂等），确保 HMR 下主题变更即时生效。
 *
 * 重要：必须在 @monaco-editor/react 的 setTheme 之前调用 defineTheme，
 * 否则 Monaco 会回退到默认 vs 主题导致 diff 颜色不一致。
 * MonacoDiffViewer / CodeEditorWidget 通过 beforeMount prop 保证时序。
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
