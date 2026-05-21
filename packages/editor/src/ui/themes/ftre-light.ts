import type { FtreThemeDefinition } from "./types";

/**
 * ftre Light — 浅色主题
 *
 * 设计理念：
 * - 基于 VS Code Light+ 色板，确保代码高亮与浅色外壳协调
 * - 关键字用深蓝色，字符串用暗红色，函数用深黄色
 * - 类型/接口用青绿色，注释用绿色
 * - 编辑器背景从 CSS 变量 --ftre-bg-base 读取，与应用外壳保持一致
 * - 选区、搜索高亮使用品牌色 (绿色系) 低透明度变体
 */
export const ftreLight: FtreThemeDefinition = {
    id: "ftre-light",
    label: "FTRE Light",
    base: "vs",
    inherit: true,
    mode: "light",
    tokenRules: [
        // ── 注释  绿色 ──
        { token: "comment", foreground: "008000", fontStyle: "italic" },
        { token: "comment.doc", foreground: "008000", fontStyle: "italic" },
        { token: "comment.block", foreground: "008000", fontStyle: "italic" },

        // ── 关键字  深蓝 ──
        { token: "keyword", foreground: "0000FF" },
        { token: "keyword.control", foreground: "AF00DB" },
        { token: "keyword.operator", foreground: "0000FF" },
        { token: "keyword.other", foreground: "0000FF" },

        // ── 存储 (let/const/var/function/class/interface/type/enum)  深蓝 ──
        { token: "storage", foreground: "0000FF" },
        { token: "storage.type", foreground: "0000FF" },
        { token: "storage.modifier", foreground: "0000FF" },

        // ── 字符串  暗红 ──
        { token: "string", foreground: "A31515" },
        { token: "string.escape", foreground: "EE0000" },
        { token: "string.template", foreground: "A31515" },
        { token: "string.key", foreground: "A31515" },
        { token: "string.value", foreground: "A31515" },

        // ── 数字  深绿 ──
        { token: "number", foreground: "098658" },
        { token: "number.hex", foreground: "098658" },
        { token: "number.float", foreground: "098658" },
        { token: "number.octal", foreground: "098658" },
        { token: "number.binary", foreground: "098658" },

        // ── 常量 (true/false/null/undefined)  深蓝 ──
        { token: "constant", foreground: "0000FF" },
        { token: "constant.language", foreground: "0000FF" },
        { token: "constant.numeric", foreground: "098658" },

        // ── 类型/类/接口  青绿 ──
        { token: "type", foreground: "267F99" },
        { token: "type.identifier", foreground: "267F99" },
        { token: "entity.name.type", foreground: "267F99" },
        { token: "entity.name.class", foreground: "267F99" },
        { token: "support.type", foreground: "267F99" },

        // ── 函数  深黄/棕 ──
        { token: "entity.name.function", foreground: "795E26" },
        { token: "support.function", foreground: "795E26" },
        { token: "function", foreground: "795E26" },
        { token: "function.declaration", foreground: "795E26" },

        // ── 变量/标识符  深灰蓝 ──
        { token: "variable", foreground: "001080" },
        { token: "variable.parameter", foreground: "001080" },
        { token: "variable.other", foreground: "001080" },
        { token: "identifier", foreground: "001080" },

        // ── 字段/属性  深蓝紫 ──
        { token: "variable.property", foreground: "001080" },
        { token: "meta.property", foreground: "001080" },

        // ── 注解/装饰器  深黄 ──
        { token: "annotation", foreground: "795E26" },
        { token: "metatag", foreground: "795E26" },

        // ── 操作符  黑色 ──
        { token: "operator", foreground: "000000" },

        // ── 分隔符  深灰 ──
        { token: "delimiter", foreground: "393A34" },
        { token: "delimiter.bracket", foreground: "393A34" },
        { token: "delimiter.parenthesis", foreground: "393A34" },
        { token: "delimiter.square", foreground: "393A34" },
        { token: "delimiter.angle", foreground: "0000FF" },

        // ── 正则表达式  暗红 ──
        { token: "regexp", foreground: "811F3F" },
        { token: "regexp.escape", foreground: "EE0000" },

        // ── HTML/XML ──
        { token: "tag", foreground: "800000" },
        { token: "tag.id", foreground: "800000" },
        { token: "tag.class", foreground: "800000" },
        { token: "attribute.name", foreground: "FF0000" },
        { token: "attribute.value", foreground: "0000FF" },
        { token: "metatag.content", foreground: "795E26" },

        // ── CSS ──
        { token: "attribute.name.css", foreground: "FF0000" },
        { token: "attribute.value.css", foreground: "0451A5" },
        { token: "attribute.value.number.css", foreground: "098658" },
        { token: "attribute.value.unit.css", foreground: "098658" },
        { token: "attribute.value.hex.css", foreground: "098658" },
        { token: "selector.css", foreground: "800000" },
        { token: "selector.id.css", foreground: "800000" },
        { token: "selector.class.css", foreground: "800000" },
        { token: "selector.tag.css", foreground: "800000" },

        // ── JSON ──
        { token: "string.key.json", foreground: "0451A5" },
        { token: "string.value.json", foreground: "A31515" },
        { token: "number.json", foreground: "098658" },
        { token: "keyword.json", foreground: "0000FF" },

        // ── Markdown ──
        { token: "markup.heading", foreground: "800000", fontStyle: "bold" },
        { token: "markup.bold", foreground: "000000", fontStyle: "bold" },
        { token: "markup.italic", foreground: "000000", fontStyle: "italic" },
        { token: "markup.underline", fontStyle: "underline" },
        { token: "markup.inline", foreground: "A31515" },
        { token: "string.link", foreground: "0451A5", fontStyle: "underline" },

        // ── YAML ──
        { token: "type.yaml", foreground: "0000FF" },
        { token: "string.yaml", foreground: "A31515" },
        { token: "number.yaml", foreground: "098658" },
        { token: "tag.yaml", foreground: "800000" },

        // ── Shell ──
        { token: "variable.shell", foreground: "267F99" },
        { token: "keyword.shell", foreground: "0000FF" },

        // ── Python ──
        { token: "keyword.python", foreground: "0000FF" },
        { token: "string.python", foreground: "A31515" },
        { token: "number.python", foreground: "098658" },
        { token: "decorator.python", foreground: "795E26" },
        { token: "self.python", foreground: "0000FF", fontStyle: "italic" },

        // ── Rust ──
        { token: "keyword.rust", foreground: "0000FF" },
        { token: "string.rust", foreground: "A31515" },
        { token: "number.rust", foreground: "098658" },
        { token: "attribute.rust", foreground: "795E26" },
        { token: "type.rust", foreground: "267F99" },

        // ── Go ──
        { token: "keyword.go", foreground: "0000FF" },
        { token: "string.go", foreground: "A31515" },
        { token: "number.go", foreground: "098658" },
        { token: "type.go", foreground: "267F99" },

        // ── SQL ──
        { token: "keyword.sql", foreground: "0000FF" },
        { token: "string.sql", foreground: "A31515" },
        { token: "number.sql", foreground: "098658" },
        { token: "operator.sql", foreground: "000000" },
        { token: "predefined.sql", foreground: "795E26" },
    ],
    editorColors: {
        // ── 基础 ──
        "editor.foreground": "#393A34",
        "editor.lineHighlightBackground": "#05966910",
        "editorCursor.foreground": "#000000",

        // ── 行号 ──
        "editorLineNumber.foreground": "#6E7681",
        "editorLineNumber.activeForeground": "#0B216F",

        // ── 选区  品牌绿低透明 ──
        "editor.selectionBackground": "#05966930",
        "editor.selectionHighlightBackground": "#05966918",
        "editor.inactiveSelectionBackground": "#05966920",

        // ── 缩进线 ──
        "editorIndentGuide.background": "#D3D4D5",
        "editorIndentGuide.activeBackground": "#939495",

        // ── 括号匹配 ──
        "editorBracketMatch.background": "#05966920",
        "editorBracketMatch.border": "#05966980",

        // ── 搜索 ──
        "editor.findMatchBackground": "#05966940",
        "editor.findMatchHighlightBackground": "#05966920",
        "editor.findMatchBorder": "#05966980",
        "editorOverviewRuler.findMatchForeground": "#059669",

        // ── 悬浮/建议/输入  浅色面板 ──
        "editorWidget.background": "#F8F9FA",
        "editorWidget.border": "#D4D4D8",
        "editorSuggestWidget.background": "#F8F9FA",
        "editorSuggestWidget.border": "#D4D4D8",
        "editorSuggestWidget.selectedBackground": "#05966920",
        "editorSuggestWidget.highlightForeground": "#059669",
        "editorSuggestWidget.focusHighlightForeground": "#059669",
        "editorHoverWidget.background": "#F8F9FA",
        "editorHoverWidget.border": "#D4D4D8",
        "input.background": "#FFFFFF",
        "input.border": "#D4D4D8",
        "dropdown.background": "#F8F9FA",

        // ── 列表 ──
        "list.hoverBackground": "#05966910",
        "list.activeSelectionBackground": "#05966920",
        "list.activeSelectionForeground": "#047857",

        // ── 滚动条 ──
        "scrollbarSlider.background": "#05966915",
        "scrollbarSlider.hoverBackground": "#05966930",
        "scrollbarSlider.activeBackground": "#05966940",

        // ── 概览尺 (minimap 右侧) ──
        "editorOverviewRuler.border": "#D4D4D8",
    },
};
