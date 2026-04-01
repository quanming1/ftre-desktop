/**
 * Monaco 主题注册
 *
 * 定义 ftre-dark 主题，从 CSS 变量读取颜色配置。
 */

import type * as Monaco from "monaco-editor";

let themeRegistered = false;

export function registerFtreTheme(monaco: typeof Monaco): void {
  if (themeRegistered) return;

  const style = getComputedStyle(document.documentElement);
  const cssVar = (name: string) => style.getPropertyValue(name).trim();

  monaco.editor.defineTheme("ftre-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "555555" },
      { token: "keyword", foreground: "c586c0" },
      { token: "string", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "type", foreground: "4ec9b0" },
    ],
    colors: {
      "editor.background": cssVar("--color-base"),
      "editor.foreground": cssVar("--color-t-primary"),
      "editorLineNumber.foreground": cssVar("--color-t-ghost"),
      "editorLineNumber.activeForeground": cssVar("--color-t-secondary"),
      "editor.selectionBackground": cssVar("--color-neon") + "33",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorCursor.foreground": cssVar("--color-neon"),
      "editorWidget.background": cssVar("--color-surface"),
      "editorWidget.border": cssVar("--color-border"),
      "input.background": cssVar("--color-panel"),
      "dropdown.background": cssVar("--color-surface"),
      "list.hoverBackground": "#ffffff0a",
      "list.activeSelectionBackground": cssVar("--color-neon") + "18",
      "editorIndentGuide.background": cssVar("--color-border"),
      "editorIndentGuide.activeBackground": cssVar("--color-t-faint"),
    },
  });

  themeRegistered = true;
}

/** Reset registration state — exposed only for testing. */
export function _resetThemeRegistration(): void {
  themeRegistered = false;
}
