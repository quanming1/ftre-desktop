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
    tokenRules: [],

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
        // ── Diff 编辑器 ──
        "diffEditor.insertedTextBackground": "#dcf1e4",
        "diffEditor.removedTextBackground": "#f4cccf",
        "diffEditor.insertedLineBackground": "#dcf1e4",
        "diffEditor.removedLineBackground": "#f4cccf",
        // inline diff 模式下 deleted 行无独立行号，gutter 背景无法对称显示，统一去掉
        // "diffEditorGutter.insertedLineBackground": "#e3f0e8",
        // "diffEditorGutter.removedLineBackground": "#fbeff2",
        "diffEditorOverviewRuler.insertedForeground": "#22c55e",
        "diffEditorOverviewRuler.deletedForeground": "#ef4444",
    },
};
