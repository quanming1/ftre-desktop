import type { FtreThemeDefinition } from "./types";

/**
 * ftre Dark — VS Code Dark+ 标准配色
 *
 * 直接使用 VS Code 内置 Dark+ 主题的色值：
 * - 关键字：#569CD6 (蓝)
 * - 控制流：#C586C0 (紫)
 * - 字符串：#CE9178 (橙)
 * - 数字：#B5CEA8 (浅绿)
 * - 类型/类：#4EC9B0 (青)
 * - 函数：#DCDCAA (黄)
 * - 变量：#9CDCFE (浅蓝)
 * - 注释：#6A9955 (绿)
 * - 属性：#9CDCFE (浅蓝)
 * - 装饰器：#DCDCAA (黄)
 * - 编辑器背景从 CSS 变量 --ftre-bg-base 读取
 */
export const darcula: FtreThemeDefinition = {
  id: "ftre-dark",
  label: "Dark+",
  base: "vs-dark",
  inherit: true,
  mode: "dark",
  tokenRules: [
    // ── 注释 ──
    { token: "comment", foreground: "6A9955" },
    { token: "comment.doc", foreground: "6A9955" },
    { token: "comment.block", foreground: "6A9955" },

    // ── 关键字 ──
    { token: "keyword", foreground: "569CD6" },
    { token: "keyword.control", foreground: "C586C0" },
    { token: "keyword.operator", foreground: "D4D4D4" },
    { token: "keyword.other", foreground: "569CD6" },

    // ── 存储 (let/const/var/function/class/interface/type/enum) ──
    { token: "storage", foreground: "569CD6" },
    { token: "storage.type", foreground: "569CD6" },
    { token: "storage.modifier", foreground: "569CD6" },

    // ── 字符串 ──
    { token: "string", foreground: "CE9178" },
    { token: "string.escape", foreground: "D7BA7D" },
    { token: "string.template", foreground: "CE9178" },
    { token: "string.key", foreground: "CE9178" },
    { token: "string.value", foreground: "CE9178" },

    // ── 数字 ──
    { token: "number", foreground: "B5CEA8" },
    { token: "number.hex", foreground: "B5CEA8" },
    { token: "number.float", foreground: "B5CEA8" },
    { token: "number.octal", foreground: "B5CEA8" },
    { token: "number.binary", foreground: "B5CEA8" },

    // ── 常量 (true/false/null/undefined) ──
    { token: "constant", foreground: "569CD6" },
    { token: "constant.language", foreground: "569CD6" },
    { token: "constant.numeric", foreground: "B5CEA8" },

    // ── 类型/类/接口 ──
    { token: "type", foreground: "4EC9B0" },
    { token: "type.identifier", foreground: "4EC9B0" },
    { token: "entity.name.type", foreground: "4EC9B0" },
    { token: "entity.name.class", foreground: "4EC9B0" },
    { token: "support.type", foreground: "4EC9B0" },

    // ── 函数 ──
    { token: "entity.name.function", foreground: "DCDCAA" },
    { token: "support.function", foreground: "DCDCAA" },
    { token: "function", foreground: "DCDCAA" },
    { token: "function.declaration", foreground: "DCDCAA" },

    // ── 变量/标识符 ──
    { token: "variable", foreground: "9CDCFE" },
    { token: "variable.parameter", foreground: "9CDCFE" },
    { token: "variable.other", foreground: "9CDCFE" },
    { token: "identifier", foreground: "9CDCFE" },

    // ── 字段/属性 ──
    { token: "variable.property", foreground: "9CDCFE" },
    { token: "meta.property", foreground: "9CDCFE" },

    // ── 注解/装饰器 ──
    { token: "annotation", foreground: "DCDCAA" },
    { token: "metatag", foreground: "DCDCAA" },
    { token: "tag", foreground: "569CD6" },

    // ── 操作符/分隔符 ──
    { token: "operator", foreground: "D4D4D4" },
    { token: "delimiter", foreground: "D4D4D4" },
    { token: "delimiter.bracket", foreground: "D4D4D4" },
    { token: "delimiter.parenthesis", foreground: "D4D4D4" },
    { token: "delimiter.square", foreground: "D4D4D4" },
    { token: "delimiter.angle", foreground: "569CD6" },

    // ── 正则表达式 ──
    { token: "regexp", foreground: "D16969" },
    { token: "regexp.escape", foreground: "D7BA7D" },

    // ── HTML/XML ──
    { token: "tag", foreground: "569CD6" },
    { token: "tag.id", foreground: "D7BA7D" },
    { token: "tag.class", foreground: "D7BA7D" },
    { token: "attribute.name", foreground: "9CDCFE" },
    { token: "attribute.value", foreground: "CE9178" },
    { token: "metatag.content", foreground: "DCDCAA" },

    // ── CSS ──
    { token: "attribute.name.css", foreground: "9CDCFE" },
    { token: "attribute.value.css", foreground: "CE9178" },
    { token: "attribute.value.number.css", foreground: "B5CEA8" },
    { token: "attribute.value.unit.css", foreground: "B5CEA8" },
    { token: "attribute.value.hex.css", foreground: "B5CEA8" },
    { token: "selector.css", foreground: "DCDCAA" },
    { token: "selector.id.css", foreground: "DCDCAA" },
    { token: "selector.class.css", foreground: "DCDCAA" },
    { token: "selector.tag.css", foreground: "569CD6" },

    // ── JSON ──
    { token: "string.key.json", foreground: "9CDCFE" },
    { token: "string.value.json", foreground: "CE9178" },
    { token: "number.json", foreground: "B5CEA8" },
    { token: "keyword.json", foreground: "569CD6" },

    // ── Markdown ──
    { token: "markup.heading", foreground: "569CD6", fontStyle: "bold" },
    { token: "markup.bold", fontStyle: "bold" },
    { token: "markup.italic", fontStyle: "italic" },
    { token: "markup.underline", fontStyle: "underline" },
    { token: "markup.inline", foreground: "CE9178" },
    { token: "string.link", foreground: "4DA8CE", fontStyle: "underline" },

    // ── YAML ──
    { token: "type.yaml", foreground: "569CD6" },
    { token: "string.yaml", foreground: "CE9178" },
    { token: "number.yaml", foreground: "B5CEA8" },
    { token: "tag.yaml", foreground: "569CD6" },

    // ── Shell ──
    { token: "variable.shell", foreground: "9CDCFE" },
    { token: "keyword.shell", foreground: "569CD6" },

    // ── Python ──
    { token: "keyword.python", foreground: "569CD6" },
    { token: "string.python", foreground: "CE9178" },
    { token: "number.python", foreground: "B5CEA8" },
    { token: "decorator.python", foreground: "DCDCAA" },
    { token: "self.python", foreground: "569CD6", fontStyle: "italic" },

    // ── Rust ──
    { token: "keyword.rust", foreground: "569CD6" },
    { token: "string.rust", foreground: "CE9178" },
    { token: "number.rust", foreground: "B5CEA8" },
    { token: "attribute.rust", foreground: "DCDCAA" },
    { token: "type.rust", foreground: "4EC9B0" },

    // ── Go ──
    { token: "keyword.go", foreground: "569CD6" },
    { token: "string.go", foreground: "CE9178" },
    { token: "number.go", foreground: "B5CEA8" },
    { token: "type.go", foreground: "4EC9B0" },

    // ── SQL ──
    { token: "keyword.sql", foreground: "569CD6" },
    { token: "string.sql", foreground: "CE9178" },
    { token: "number.sql", foreground: "B5CEA8" },
    { token: "operator.sql", foreground: "D4D4D4" },
    { token: "predefined.sql", foreground: "DCDCAA" },
  ],
  editorColors: {
    "editor.foreground": "#D4D4D4",
    "editor.selectionBackground": "#264F78",
    "editor.inactiveSelectionBackground": "#3A3D41",
    "editor.selectionHighlightBackground": "#264F7840",
    "editor.lineHighlightBackground": "#2A2D2E",
    "editorCursor.foreground": "#AEAFAD",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#C6C6C6",
    "editorIndentGuide.background": "#404040",
    "editorIndentGuide.activeBackground": "#707070",
    "editorBracketMatch.background": "#0064001A",
    "editorBracketMatch.border": "#888888",
    "editor.findMatchBackground": "#515C6A",
    "editor.findMatchHighlightBackground": "#515C6A55",
    "editorOverviewRuler.findMatchForeground": "#515C6A",
    "editorWidget.background": "#1E1E1E",
    "editorWidget.border": "#454545",
    "editorSuggestWidget.background": "#252526",
    "editorSuggestWidget.border": "#454545",
    "editorSuggestWidget.selectedBackground": "#04395E",
    "editorSuggestWidget.highlightForeground": "#4DA8CE",
    "editorHoverWidget.background": "#252526",
    "editorHoverWidget.border": "#454545",
    "input.background": "#3C3C3C",
    "input.border": "#3C3C3C",
    "dropdown.background": "#252526",
    "list.hoverBackground": "#2A2D2E",
    "list.activeSelectionBackground": "#04395E",
    "list.activeSelectionForeground": "#FFFFFF",
    "scrollbarSlider.background": "#79797966",
    "scrollbarSlider.hoverBackground": "#646464B3",
    "scrollbarSlider.activeBackground": "#BFBFBF66",
    "editorOverviewRuler.border": "#1E1E1E",
  },
};
