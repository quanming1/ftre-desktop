import type { FtreThemeDefinition } from "./types";

/**
 * ftre Light — One Light (Atom/Zed) 配色
 *
 * - 关键字：#a626a4 (品红)
 * - 控制流：#a626a4 (品红)
 * - 字符串：#50a14f (绿)
 * - 数字：#986801 (橙)
 * - 类型/类：#c18401 (深橙)
 * - 函数：#4078f2 (蓝)
 * - 变量：#e45549 (红)
 * - 注释：#a0a1a7 (灰)
 * - 标签：#e45549 (红)
 * - 装饰器：#986801 (橙)
 * - 编辑器背景从 CSS 变量 --ftre-bg-base 读取
 */
export const ftreLight: FtreThemeDefinition = {
    id: "ftre-light",
    label: "One Light",
    base: "vs",
    inherit: true,
    mode: "light",
    tokenRules: [
        // ── 注释 ──
        { token: "comment", foreground: "a0a1a7" },
        { token: "comment.doc", foreground: "a0a1a7" },
        { token: "comment.block", foreground: "a0a1a7" },

        // ── 关键字 ──
        { token: "keyword", foreground: "a626a4" },
        { token: "keyword.control", foreground: "a626a4" },
        { token: "keyword.operator", foreground: "383a42" },
        { token: "keyword.other", foreground: "a626a4" },

        // ── 存储 (let/const/var/function/class/interface/type/enum) ──
        { token: "storage", foreground: "a626a4" },
        { token: "storage.type", foreground: "a626a4" },
        { token: "storage.modifier", foreground: "a626a4" },

        // ── 字符串 ──
        { token: "string", foreground: "50a14f" },
        { token: "string.escape", foreground: "50a14f" },
        { token: "string.template", foreground: "50a14f" },
        { token: "string.key", foreground: "50a14f" },
        { token: "string.value", foreground: "50a14f" },

        // ── 数字 ──
        { token: "number", foreground: "986801" },
        { token: "number.hex", foreground: "986801" },
        { token: "number.float", foreground: "986801" },
        { token: "number.octal", foreground: "986801" },
        { token: "number.binary", foreground: "986801" },

        // ── 常量 (true/false/null/undefined) ──
        { token: "constant", foreground: "986801" },
        { token: "constant.language", foreground: "a626a4" },
        { token: "constant.numeric", foreground: "986801" },

        // ── 类型/类/接口 ──
        { token: "type", foreground: "c18401" },
        { token: "type.identifier", foreground: "c18401" },
        { token: "entity.name.type", foreground: "c18401" },
        { token: "entity.name.class", foreground: "c18401" },
        { token: "support.type", foreground: "c18401" },

        // ── 函数 ──
        { token: "entity.name.function", foreground: "4078f2" },
        { token: "support.function", foreground: "4078f2" },
        { token: "function", foreground: "4078f2" },
        { token: "function.declaration", foreground: "4078f2" },

        // ── 变量/标识符 ──
        { token: "variable", foreground: "e45549" },
        { token: "variable.parameter", foreground: "383a42" },
        { token: "variable.other", foreground: "383a42" },
        { token: "identifier", foreground: "383a42" },

        // ── 字段/属性 ──
        { token: "variable.property", foreground: "383a42" },
        { token: "entity.name.tag", foreground: "e45549" },
        { token: "entity.other.attribute-name", foreground: "c18401" },
        { token: "support.class", foreground: "c18401" },
        { token: "support.constant", foreground: "986801" },
        { token: "support.variable", foreground: "e45549" },

        // ── 装饰器 ──
        { token: "decorator", foreground: "986801" },
        { token: "meta.decorator", foreground: "986801" },

        // ── JSX/HTML ──
        { token: "tag", foreground: "e45549" },
        { token: "attribute.name", foreground: "c18401" },
        { token: "attribute.value", foreground: "50a14f" },

        // ── JSON ──
        { token: "string.key.json", foreground: "c18401" },

        // ── CSS ──
        { token: "attribute.value.css", foreground: "986801" },
        { token: "keyword.css", foreground: "a626a4" },

        // ── Markdown ──
        { token: "keyword.md", foreground: "a626a4" },
        { token: "string.md", foreground: "50a14f" },

        // ── 括号/分隔符 ──
        { token: "delimiter", foreground: "383a42" },
        { token: "delimiter.html", foreground: "383a42" },
        { token: "delimiter.js", foreground: "383a42" },

        // ── 特殊 ──
        { token: "regexp", foreground: "4b8BB8" },
        { token: "namespace", foreground: "c18401" },
    ],

    editorColors: {
        "editor.foreground": "#383a42",
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
        // ── Diff 编辑器 ──
        // 颜色参考 VS Code: src/vs/platform/theme/common/colors/editorColors.ts:265-334
        // insertedTextBackground / removedTextBackground 设为透明避免双层叠加混色（见坑 5）
        "diffEditor.insertedTextBackground": "#dcf1e400",
        "diffEditor.removedTextBackground": "#f4cccf00",
        "diffEditor.insertedLineBackground": "#dcf1e4",
        "diffEditor.removedLineBackground": "#f4cccf",
        // inline diff 模式下 deleted 行无独立行号，gutter 背景无法对称显示，统一去掉
        // "diffEditorGutter.insertedLineBackground": "#e3f0e8",
        // "diffEditorGutter.removedLineBackground": "#fbeff2",
        "diffEditorOverviewRuler.insertedForeground": "#22c55e",
        "diffEditorOverviewRuler.deletedForeground": "#ef4444",
        // ── 从 VS Code 借鉴的补充色 ──
        "diffEditor.diagonalFill": "#22222233",        // side-by-side 模式的对角线填充
        "diffEditor.unchangedRegionBackground": "#f8f8f8", // 折叠未变更区域的背景色
        "diffEditor.unchangedCodeBackground": "#b8b8b829", // 未变更代码的暗化背景
    },
};
