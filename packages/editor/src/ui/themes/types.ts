import type { editor } from "monaco-editor";

export interface FtreThemeTokenRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

export interface FtreThemeDefinition {
  id: string;
  label: string;
  base: editor.BuiltinTheme;
  inherit: boolean;
  /** 该主题适用的 resolved mode */
  mode: "light" | "dark";
  tokenRules: FtreThemeTokenRule[];
  editorColors: Record<string, string>;
}
