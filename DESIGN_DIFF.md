# 设计稿 vs 当前代码 — 逐文件差异对比

## 对比基准
- 设计稿: `design/src/app/`
- 我们的: `packages/desktop/src/`

---

## 1. TitleBar (对应设计稿 TopBar)

- [x] Pixel dot 加 rounded-none (方形像素)
- [x] Window controls 加 rounded-none
- [x] 加 hoveredTab 状态让 dot 在 hover 时变色

## 2. StatusBar (对应设计稿 CommandBar)

- [x] StatusBar 加真正的 input 框，支持输入
- [x] 根据 mode 切换 placeholder
- [x] 加 Ln 行号显示

## 3. Workbench (对应设计稿 App)

- [x] 加 FilePalette 组件 (Ctrl+P 快捷键)
- [x] Code/AI 面板加 transition-all duration-300

## 4-7. ChatPanel / ChatInput / UserMessage / AssistantMessage

全部 OK，无需修复。

## 8. EditorArea (对应设计稿 CodeEditor)

- [x] EditorArea 背景改为 bg-[#0e0e10]
- [x] Breadcrumb 改为正常 flow，去掉 absolute 和 pt-[33px]
- [x] 分隔符改为 ›

## 9-12. ToolCallCard / ModelSelector / Sidebar / TerminalPanel

设计稿无对应组件，保持现状。

## 13. FilePalette

- [x] 从设计稿移植 FilePalette 组件
- [x] 在 Workbench 加 Ctrl+P 快捷键

---

## 全部完成
