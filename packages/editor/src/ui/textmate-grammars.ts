/**
 * TextMate Grammar 注册
 *
 * 从 VS Code 内置语法文件（.tmLanguage.json）加载 TextMate grammar，
 * 注册到 textmate-registry。
 *
 * Grammar 文件通过 Vite 的 JSON import 直接打包进来，
 * 按需加载：只有项目用到的语言才打包。
 *
 * 新增语言只需：
 *   1. 将 .tmLanguage.json 放到 grammars/ 目录
 *   2. 在此处调用 registerGrammar()
 */

import { registerGrammar } from "./textmate-registry";

// TypeScript
registerGrammar("typescript", "source.ts", async () => {
  const grammar = await import("./grammars/TypeScript.tmLanguage.json");
  return grammar.default as any;
});

// TSX (TypeScript JSX) — 用 TypeScript.tmLanguage 的变体 scope
registerGrammar("typescriptreact", "source.tsx", async () => {
  const grammar = await import("./grammars/TypeScriptReact.tmLanguage.json");
  return grammar.default as any;
});

// JavaScript
registerGrammar("javascript", "source.js", async () => {
  const grammar = await import("./grammars/JavaScript.tmLanguage.json");
  return grammar.default as any;
});

// JSX (JavaScript React)
registerGrammar("javascriptreact", "source.js.jsx", async () => {
  const grammar = await import("./grammars/JavaScriptReact.tmLanguage.json");
  return grammar.default as any;
});

// Python
registerGrammar("python", "source.python", async () => {
  const grammar = await import("./grammars/Python.tmLanguage.json");
  return grammar.default as any;
});

// JSON
registerGrammar("json", "source.json", async () => {
  const grammar = await import("./grammars/JSON.tmLanguage.json");
  return grammar.default as any;
});

// CSS
registerGrammar("css", "source.css", async () => {
  const grammar = await import("./grammars/CSS.tmLanguage.json");
  return grammar.default as any;
});

// HTML
registerGrammar("html", "text.html.basic", async () => {
  const grammar = await import("./grammars/HTML.tmLanguage.json");
  return grammar.default as any;
});

// Shell / Bash
registerGrammar("shell", "source.shell", async () => {
  const grammar = await import("./grammars/Shell-Unix-Bash.tmLanguage.json");
  return grammar.default as any;
});

// YAML
registerGrammar("yaml", "source.yaml", async () => {
  const grammar = await import("./grammars/YAML.tmLanguage.json");
  return grammar.default as any;
});

// Markdown
registerGrammar("markdown", "text.html.markdown", async () => {
  const grammar = await import("./grammars/Markdown.tmLanguage.json");
  return grammar.default as any;
});
