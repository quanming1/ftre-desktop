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
  tokenRules: FtreThemeTokenRule[];
  editorColors: Record<string, string>;
}
