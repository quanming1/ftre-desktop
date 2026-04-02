import type { FtreThemeDefinition } from "./types";

/**
 * ftre Neon — 项目专属主题
 *
 * 设计理念：
 * - 以品牌色 #00ff88 (neon green) 为锚点贯穿编辑器
 * - 冷色调为主（青、蓝、紫），暖色点缀（金、橙、珊瑚）
 * - 关键字用薰衣草紫，字符串用 neon 柔绿，函数用琥珀金
 * - 类型/接口用电光青呼应品牌色
 * - 光标、选区、括号匹配、搜索高亮全部围绕 neon green
 */
export const ftreNeon: FtreThemeDefinition = {
  id: "ftre-neon",
  label: "ftre Neon",
  base: "vs-dark",
  inherit: true,
  tokenRules: [
    // ── 注释 ──
    { token: "comment", foreground: "637777", fontStyle: "italic" },
    { token: "comment.doc", foreground: "7A9B8D", fontStyle: "italic" },
    { token: "comment.block", foreground: "637777", fontStyle: "italic" },

    // ── 关键字  薰衣草紫 ──
    { token: "keyword", foreground: "C792EA" },
    { token: "keyword.control", foreground: "C792EA" },
    { token: "keyword.operator", foreground: "89DDFF" },
    { token: "keyword.other", foreground: "C792EA" },

    // ── 存储  紫色 (let/const/var/function/class/interface/type/enum) ──
    { token: "storage", foreground: "C792EA" },
    { token: "storage.type", foreground: "C792EA" },
    { token: "storage.modifier", foreground: "C792EA" },

    // ── 字符串  Neon 柔绿 ──
    { token: "string", foreground: "7EC699" },
    { token: "string.escape", foreground: "00FF88" },
    { token: "string.template", foreground: "7EC699" },
    { token: "string.key", foreground: "7EC699" },
    { token: "string.value", foreground: "7EC699" },

    // ── 数字  冰蓝 ──
    { token: "number", foreground: "82AAFF" },
    { token: "number.hex", foreground: "82AAFF" },
    { token: "number.float", foreground: "82AAFF" },
    { token: "number.octal", foreground: "82AAFF" },
    { token: "number.binary", foreground: "82AAFF" },

    // ── 常量 (true/false/null/undefined)  珊瑚橙 ──
    { token: "constant", foreground: "F78C6C" },
    { token: "constant.language", foreground: "F78C6C" },
    { token: "constant.numeric", foreground: "82AAFF" },

    // ── 类型/类/接口  电光青 ──
    { token: "type", foreground: "00E5CC" },
    { token: "type.identifier", foreground: "00E5CC" },
    { token: "entity.name.type", foreground: "00E5CC" },
    { token: "entity.name.class", foreground: "00E5CC" },
    { token: "support.type", foreground: "00E5CC" },

    // ── 函数  琥珀金 ──
    { token: "entity.name.function", foreground: "FFCB6B" },
    { token: "support.function", foreground: "FFCB6B" },
    { token: "function", foreground: "FFCB6B" },
    { token: "function.declaration", foreground: "FFCB6B" },

    // ── 变量/标识符  浅灰蓝 ──
    { token: "variable", foreground: "BABED8" },
    { token: "variable.parameter", foreground: "BABED8" },
    { token: "variable.other", foreground: "BABED8" },
    { token: "identifier", foreground: "BABED8" },

    // ── 字段/属性  浅紫 ──
    { token: "variable.property", foreground: "B2A4D4" },
    { token: "meta.property", foreground: "B2A4D4" },

    // ── 注解/装饰器  柠檬黄 ──
    { token: "annotation", foreground: "DECB6B" },
    { token: "metatag", foreground: "DECB6B" },

    // ── 操作符  青白 ──
    { token: "operator", foreground: "89DDFF" },

    // ── 分隔符  灰蓝 ──
    { token: "delimiter", foreground: "A6ACCD" },
    { token: "delimiter.bracket", foreground: "A6ACCD" },
    { token: "delimiter.parenthesis", foreground: "A6ACCD" },
    { token: "delimiter.square", foreground: "A6ACCD" },
    { token: "delimiter.angle", foreground: "C792EA" },

    // ── 正则表达式  钢蓝 ──
    { token: "regexp", foreground: "89DDFF" },
    { token: "regexp.escape", foreground: "00FF88" },

    // ── HTML/XML ──
    { token: "tag", foreground: "F07178" },
    { token: "tag.id", foreground: "F07178" },
    { token: "tag.class", foreground: "F07178" },
    { token: "attribute.name", foreground: "FFCB6B" },
    { token: "attribute.value", foreground: "7EC699" },
    { token: "metatag.content", foreground: "DECB6B" },

    // ── CSS ──
    { token: "attribute.name.css", foreground: "BABED8" },
    { token: "attribute.value.css", foreground: "7EC699" },
    { token: "attribute.value.number.css", foreground: "82AAFF" },
    { token: "attribute.value.unit.css", foreground: "F78C6C" },
    { token: "attribute.value.hex.css", foreground: "82AAFF" },
    { token: "selector.css", foreground: "FFCB6B" },
    { token: "selector.id.css", foreground: "FFCB6B" },
    { token: "selector.class.css", foreground: "00E5CC" },
    { token: "selector.tag.css", foreground: "F07178" },

    // ── JSON ──
    { token: "string.key.json", foreground: "B2A4D4" },
    { token: "string.value.json", foreground: "7EC699" },
    { token: "number.json", foreground: "82AAFF" },
    { token: "keyword.json", foreground: "F78C6C" },

    // ── Markdown ──
    { token: "markup.heading", foreground: "FFCB6B", fontStyle: "bold" },
    { token: "markup.bold", foreground: "F07178", fontStyle: "bold" },
    { token: "markup.italic", foreground: "C792EA", fontStyle: "italic" },
    { token: "markup.underline", fontStyle: "underline" },
    { token: "markup.inline", foreground: "7EC699" },
    { token: "string.link", foreground: "82AAFF", fontStyle: "underline" },

    // ── YAML ──
    { token: "type.yaml", foreground: "C792EA" },
    { token: "string.yaml", foreground: "7EC699" },
    { token: "number.yaml", foreground: "82AAFF" },
    { token: "tag.yaml", foreground: "F07178" },

    // ── Shell ──
    { token: "variable.shell", foreground: "00E5CC" },
    { token: "keyword.shell", foreground: "C792EA" },

    // ── Python ──
    { token: "keyword.python", foreground: "C792EA" },
    { token: "string.python", foreground: "7EC699" },
    { token: "number.python", foreground: "82AAFF" },
    { token: "decorator.python", foreground: "DECB6B" },
    { token: "self.python", foreground: "F78C6C", fontStyle: "italic" },

    // ── Rust ──
    { token: "keyword.rust", foreground: "C792EA" },
    { token: "string.rust", foreground: "7EC699" },
    { token: "number.rust", foreground: "82AAFF" },
    { token: "attribute.rust", foreground: "DECB6B" },
    { token: "type.rust", foreground: "00E5CC" },

    // ── Go ──
    { token: "keyword.go", foreground: "C792EA" },
    { token: "string.go", foreground: "7EC699" },
    { token: "number.go", foreground: "82AAFF" },
    { token: "type.go", foreground: "00E5CC" },

    // ── SQL ──
    { token: "keyword.sql", foreground: "C792EA" },
    { token: "string.sql", foreground: "7EC699" },
    { token: "number.sql", foreground: "82AAFF" },
    { token: "operator.sql", foreground: "89DDFF" },
    { token: "predefined.sql", foreground: "FFCB6B" },
  ],
  editorColors: {
    // ── 基础 ──
    "editor.foreground": "#BABED8",
    "editor.lineHighlightBackground": "#00FF8808",
    "editorCursor.foreground": "#00FF88",

    // ── 行号 ──
    "editorLineNumber.foreground": "#4B5263",
    "editorLineNumber.activeForeground": "#00FF88",

    // ── 选区  neon green 低透明 ──
    "editor.selectionBackground": "#00FF8828",
    "editor.selectionHighlightBackground": "#00FF8815",
    "editor.inactiveSelectionBackground": "#00FF8818",

    // ── 缩进线 ──
    "editorIndentGuide.background": "#3A3F4B",
    "editorIndentGuide.activeBackground": "#00FF8830",

    // ── 括号匹配  neon green 边框 ──
    "editorBracketMatch.background": "#00FF8818",
    "editorBracketMatch.border": "#00FF8880",

    // ── 搜索 ──
    "editor.findMatchBackground": "#00FF8840",
    "editor.findMatchHighlightBackground": "#00FF8820",
    "editor.findMatchBorder": "#00FF8880",
    "editorOverviewRuler.findMatchForeground": "#00FF88",

    // ── 悬浮/建议/输入  深色面板 ──
    "editorWidget.background": "#252530",
    "editorWidget.border": "#3A3F4B",
    "editorSuggestWidget.background": "#252530",
    "editorSuggestWidget.border": "#3A3F4B",
    "editorSuggestWidget.selectedBackground": "#00FF8820",
    "editorSuggestWidget.highlightForeground": "#00FF88",
    "editorSuggestWidget.focusHighlightForeground": "#00FF88",
    "editorHoverWidget.background": "#252530",
    "editorHoverWidget.border": "#3A3F4B",
    "input.background": "#1E1E2A",
    "input.border": "#3A3F4B",
    "dropdown.background": "#252530",

    // ── 列表 ──
    "list.hoverBackground": "#00FF8810",
    "list.activeSelectionBackground": "#00FF8820",
    "list.activeSelectionForeground": "#00FF88",

    // ── 滚动条 ──
    "scrollbarSlider.background": "#00FF8815",
    "scrollbarSlider.hoverBackground": "#00FF8825",
    "scrollbarSlider.activeBackground": "#00FF8835",

    // ── 概览尺 (minimap 右侧) ──
    "editorOverviewRuler.border": "#3A3F4B",
  },
};
