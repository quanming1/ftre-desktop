import type { FtreThemeDefinition } from "./types";

export const darcula: FtreThemeDefinition = {
  id: "ftre-dark",
  label: "Darcula",
  base: "vs-dark",
  inherit: true,
  mode: "dark",
  tokenRules: [
    // ── 注释 ──
    { token: "comment", foreground: "808080" },
    { token: "comment.doc", foreground: "629755" },
    { token: "comment.block", foreground: "808080" },

    // ── 关键字 ──
    { token: "keyword", foreground: "CC7832" },
    { token: "keyword.control", foreground: "CC7832" },
    { token: "keyword.operator", foreground: "CC7832" },
    { token: "keyword.other", foreground: "CC7832" },

    // ── 存储 (let/const/var/function/class/interface/type/enum) ──
    { token: "storage", foreground: "CC7832" },
    { token: "storage.type", foreground: "CC7832" },
    { token: "storage.modifier", foreground: "CC7832" },

    // ── 字符串 ──
    { token: "string", foreground: "6A8759" },
    { token: "string.escape", foreground: "CC7832" },
    { token: "string.template", foreground: "6A8759" },
    { token: "string.key", foreground: "6A8759" },
    { token: "string.value", foreground: "6A8759" },

    // ── 数字 ──
    { token: "number", foreground: "6897BB" },
    { token: "number.hex", foreground: "6897BB" },
    { token: "number.float", foreground: "6897BB" },
    { token: "number.octal", foreground: "6897BB" },
    { token: "number.binary", foreground: "6897BB" },

    // ── 常量 (true/false/null/undefined) ──
    { token: "constant", foreground: "CC7832", fontStyle: "bold" },
    { token: "constant.language", foreground: "CC7832", fontStyle: "bold" },
    { token: "constant.numeric", foreground: "6897BB" },

    // ── 类型/类/接口 ──
    { token: "type", foreground: "A9B7C6" },
    { token: "type.identifier", foreground: "A9B7C6" },
    { token: "entity.name.type", foreground: "A9B7C6" },
    { token: "entity.name.class", foreground: "A9B7C6" },
    { token: "support.type", foreground: "A9B7C6" },

    // ── 函数 ──
    { token: "entity.name.function", foreground: "FFC66D" },
    { token: "support.function", foreground: "FFC66D" },
    { token: "function", foreground: "FFC66D" },
    { token: "function.declaration", foreground: "FFC66D" },

    // ── 变量/标识符 ──
    { token: "variable", foreground: "A9B7C6" },
    { token: "variable.parameter", foreground: "A9B7C6" },
    { token: "variable.other", foreground: "A9B7C6" },
    { token: "identifier", foreground: "A9B7C6" },

    // ── 字段/属性 ──
    { token: "variable.property", foreground: "9876AA" },
    { token: "meta.property", foreground: "9876AA" },

    // ── 注解/装饰器 ──
    { token: "annotation", foreground: "BBB529" },
    { token: "metatag", foreground: "BBB529" },
    { token: "tag", foreground: "E8BF6A" },

    // ── 操作符/分隔符 ──
    { token: "operator", foreground: "A9B7C6" },
    { token: "delimiter", foreground: "A9B7C6" },
    { token: "delimiter.bracket", foreground: "A9B7C6" },
    { token: "delimiter.parenthesis", foreground: "A9B7C6" },
    { token: "delimiter.square", foreground: "A9B7C6" },
    { token: "delimiter.angle", foreground: "CC7832" },

    // ── 正则表达式 ──
    { token: "regexp", foreground: "646695" },
    { token: "regexp.escape", foreground: "CC7832" },

    // ── HTML/XML ──
    { token: "tag", foreground: "E8BF6A" },
    { token: "tag.id", foreground: "E8BF6A" },
    { token: "tag.class", foreground: "E8BF6A" },
    { token: "attribute.name", foreground: "BABABA" },
    { token: "attribute.value", foreground: "6A8759" },
    { token: "metatag.content", foreground: "BBB529" },

    // ── CSS ──
    { token: "attribute.name.css", foreground: "A9B7C6" },
    { token: "attribute.value.css", foreground: "A5C261" },
    { token: "attribute.value.number.css", foreground: "6897BB" },
    { token: "attribute.value.unit.css", foreground: "CC7832" },
    { token: "attribute.value.hex.css", foreground: "6897BB" },
    { token: "selector.css", foreground: "FFC66D" },
    { token: "selector.id.css", foreground: "FFC66D" },
    { token: "selector.class.css", foreground: "FFC66D" },
    { token: "selector.tag.css", foreground: "E8BF6A" },

    // ── JSON ──
    { token: "string.key.json", foreground: "9876AA" },
    { token: "string.value.json", foreground: "6A8759" },
    { token: "number.json", foreground: "6897BB" },
    { token: "keyword.json", foreground: "CC7832" },

    // ── Markdown ──
    { token: "markup.heading", foreground: "FFC66D", fontStyle: "bold" },
    { token: "markup.bold", fontStyle: "bold" },
    { token: "markup.italic", fontStyle: "italic" },
    { token: "markup.underline", fontStyle: "underline" },
    { token: "markup.inline", foreground: "6A8759" },
    { token: "string.link", foreground: "6897BB", fontStyle: "underline" },

    // ── YAML ──
    { token: "type.yaml", foreground: "CC7832" },
    { token: "string.yaml", foreground: "6A8759" },
    { token: "number.yaml", foreground: "6897BB" },
    { token: "tag.yaml", foreground: "E8BF6A" },

    // ── Shell ──
    { token: "variable.shell", foreground: "A5C261" },
    { token: "keyword.shell", foreground: "CC7832" },

    // ── Python ──
    { token: "keyword.python", foreground: "CC7832" },
    { token: "string.python", foreground: "6A8759" },
    { token: "number.python", foreground: "6897BB" },
    { token: "decorator.python", foreground: "BBB529" },
    { token: "self.python", foreground: "CC7832", fontStyle: "italic" },

    // ── Rust ──
    { token: "keyword.rust", foreground: "CC7832" },
    { token: "string.rust", foreground: "6A8759" },
    { token: "number.rust", foreground: "6897BB" },
    { token: "attribute.rust", foreground: "BBB529" },
    { token: "type.rust", foreground: "A9B7C6" },

    // ── Go ──
    { token: "keyword.go", foreground: "CC7832" },
    { token: "string.go", foreground: "6A8759" },
    { token: "number.go", foreground: "6897BB" },
    { token: "type.go", foreground: "A9B7C6" },

    // ── SQL ──
    { token: "keyword.sql", foreground: "CC7832" },
    { token: "string.sql", foreground: "6A8759" },
    { token: "number.sql", foreground: "6897BB" },
    { token: "operator.sql", foreground: "A9B7C6" },
    { token: "predefined.sql", foreground: "FFC66D" },
  ],
  editorColors: {
    "editor.foreground": "#A9B7C6",
    "editor.selectionBackground": "#214283",
    "editor.lineHighlightBackground": "#323232",
    "editorCursor.foreground": "#BBBBBB",
    "editorLineNumber.foreground": "#606366",
    "editorLineNumber.activeForeground": "#A4A3A3",
    "editorIndentGuide.background": "#3B3B3B",
    "editorIndentGuide.activeBackground": "#505050",
    "editorBracketMatch.background": "#3B514D",
    "editorBracketMatch.border": "#3B514D",
    "editor.findMatchBackground": "#32593D",
    "editor.findMatchHighlightBackground": "#214283",
    "editorOverviewRuler.findMatchForeground": "#6A8759",
    "editorWidget.background": "#3C3F41",
    "editorWidget.border": "#4B4B4B",
    "editorSuggestWidget.background": "#3C3F41",
    "editorSuggestWidget.border": "#4B4B4B",
    "editorSuggestWidget.selectedBackground": "#4B6EAF",
    "editorSuggestWidget.highlightForeground": "#FFC66D",
    "editorHoverWidget.background": "#3C3F41",
    "editorHoverWidget.border": "#4B4B4B",
    "input.background": "#45494A",
    "input.border": "#5E6060",
    "dropdown.background": "#3C3F41",
    "list.hoverBackground": "#3C3F41",
    "list.activeSelectionBackground": "#4B6EAF",
    "scrollbarSlider.background": "#4F4F4F80",
    "scrollbarSlider.hoverBackground": "#5F5F5FA0",
    "scrollbarSlider.activeBackground": "#6F6F6FC0",
  },
};
