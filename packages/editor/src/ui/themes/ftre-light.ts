import type { FtreThemeDefinition } from "./types";

/**
 * ftre Light — VS Code Light+ 标准配色
 *
 * 直接使用 VS Code 内置 Light+ 主题的色值：
 * - 关键字：#0000FF (蓝)
 * - 控制流：#AF00DB (紫)
 * - 字符串：#A31515 (暗红)
 * - 数字：#098658 (深绿)
 * - 类型/类：#267F99 (青绿)
 * - 函数：#795E26 (棕)
 * - 变量：#001080 (深蓝)
 * - 注释：#008000 (绿)
 * - 编辑器背景从 CSS 变量 --ftre-bg-base 读取
 */
export const ftreLight: FtreThemeDefinition = {
    id: "ftre-light",
    label: "Light+",
    base: "vs",
    inherit: true,
    mode: "light",
    tokenRules: [
        // ── 注释 ──
        { token: "comment", foreground: "008000", fontStyle: "italic" },
        { token: "comment.doc", foreground: "008000", fontStyle: "italic" },
        { token: "comment.block", foreground: "008000", fontStyle: "italic" },

        // ── 关键字 ──
        { token: "keyword", foreground: "0000FF" },
        { token: "keyword.control", foreground: "AF00DB" },
        { token: "keyword.operator", foreground: "000000" },
        { token: "keyword.other", foreground: "0000FF" },

        // ── 存储 ──
        { token: "storage", foreground: "0000FF" },
        { token: "storage.type", foreground: "0000FF" },
        { token: "storage.modifier", foreground: "0000FF" },

        // ── 字符串 ──
        { token: "string", foreground: "A31515" },
        { token: "string.escape", foreground: "EE0000" },
        { token: "string.template", foreground: "A31515" },
        { token: "string.key", foreground: "A31515" },
        { token: "string.value", foreground: "A31515" },

        // ── 数字 ──
        { token: "number", foreground: "098658" },
        { token: "number.hex", foreground: "098658" },
        { token: "number.float", foreground: "098658" },
        { token: "number.octal", foreground: "098658" },
        { token: "number.binary", foreground: "098658" },

        // ── 常量 ──
        { token: "constant", foreground: "0000FF" },
        { token: "constant.language", foreground: "0000FF" },
        { token: "constant.numeric", foreground: "098658" },

        // ── 类型/类/接口 ──
        { token: "type", foreground: "267F99" },
        { token: "type.identifier", foreground: "267F99" },
        { token: "entity.name.type", foreground: "267F99" },
        { token: "entity.name.class", foreground: "267F99" },
        { token: "support.type", foreground: "267F99" },

        // ── 函数 ──
        { token: "entity.name.function", foreground: "795E26" },
        { token: "support.function", foreground: "795E26" },
        { token: "function", foreground: "795E26" },
        { token: "function.declaration", foreground: "795E26" },

        // ── 变量/标识符 ──
        { token: "variable", foreground: "001080" },
        { token: "variable.parameter", foreground: "001080" },
        { token: "variable.other", foreground: "001080" },
        { token: "identifier", foreground: "001080" },

        // ── 字段/属性 ──
        { token: "variable.property", foreground: "001080" },
        { token: "meta.property", foreground: "001080" },

        // ── 注解/装饰器 ──
        { token: "annotation", foreground: "795E26" },
        { token: "metatag", foreground: "795E26" },

        // ── 操作符/分隔符 ──
        { token: "operator", foreground: "000000" },
        { token: "delimiter", foreground: "393A34" },
        { token: "delimiter.bracket", foreground: "393A34" },
        { token: "delimiter.parenthesis", foreground: "393A34" },
        { token: "delimiter.square", foreground: "393A34" },
        { token: "delimiter.angle", foreground: "0000FF" },

        // ── 正则表达式 ──
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
        "editor.foreground": "#393A34",
        "editor.selectionBackground": "#ADD6FF",
        "editor.inactiveSelectionBackground": "#E5EBF1",
        "editor.selectionHighlightBackground": "#ADD6FF80",
        "editor.lineHighlightBackground": "#0000000A",
        "editorCursor.foreground": "#000000",
        "editorLineNumber.foreground": "#6E7681",
        "editorLineNumber.activeForeground": "#0B216F",
        "editorIndentGuide.background": "#D3D4D5",
        "editorIndentGuide.activeBackground": "#939495",
        "editorBracketMatch.background": "#0064001A",
        "editorBracketMatch.border": "#888888",
        "editor.findMatchBackground": "#A8AC94",
        "editor.findMatchHighlightBackground": "#EA5C004D",
        "editorOverviewRuler.findMatchForeground": "#A8AC94",
        "editorWidget.background": "#F3F3F3",
        "editorWidget.border": "#C8C8C8",
        "editorSuggestWidget.background": "#F3F3F3",
        "editorSuggestWidget.border": "#C8C8C8",
        "editorSuggestWidget.selectedBackground": "#E4E4F0",
        "editorSuggestWidget.highlightForeground": "#0066A0",
        "editorHoverWidget.background": "#F3F3F3",
        "editorHoverWidget.border": "#C8C8C8",
        "input.background": "#FFFFFF",
        "input.border": "#C8C8C8",
        "dropdown.background": "#FFFFFF",
        "list.hoverBackground": "#E8E8E8",
        "list.activeSelectionBackground": "#0060C0",
        "list.activeSelectionForeground": "#FFFFFF",
        "scrollbarSlider.background": "#64646466",
        "scrollbarSlider.hoverBackground": "#646464B3",
        "scrollbarSlider.activeBackground": "#00000099",
        "editorOverviewRuler.border": "#C8C8C8",
    },
};
