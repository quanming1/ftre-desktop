# 终端功能特性

> 终端相关的快捷键、配置和注意事项

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/services/terminal/terminal-keybindings.ts` | 终端自定义快捷键处理 |
| `packages/renderer/src/services/terminal/terminal-manager.ts` | 终端实例管理和字体大小同步 |
| `packages/renderer/src/services/terminal/terminal-config.ts` | 终端配置常量 |

## 业务流程

### 字体缩放流程
`terminal-keybindings.ts:attachKeybindings` → `terminal-manager.ts:onFontSizeChange` → 同步所有终端实例

## 关键数据结构

TerminalConfig: `{ DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE }`

## 注意事项

- 字体放大快捷键是 **Ctrl+=** 而不是 Ctrl++（因为键盘事件的 key 值是 '=' 而不是 '+'）
- 字体缩小快捷键是 Ctrl+-
- 重置字体大小快捷键是 Ctrl+0
- Ctrl+C 在有选中文本时执行复制，否则发送中断信号 (SIGINT)
- 备用复制粘贴快捷键：Ctrl+Shift+C / Ctrl+Shift+V