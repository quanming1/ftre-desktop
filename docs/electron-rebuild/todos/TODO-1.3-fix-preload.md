# TODO-1.3: 修复 preload 脚本编译

## 阶段
Phase 1: 基础骨架

## 状态
- [x] 完成

## 目标
确保 preload.ts 正常编译，contextBridge 注入 window.desktop API。

## 涉及文件
- `packages/electron/src/preload.ts`
- `packages/shared/src/types.ts` (DesktopAPI 类型定义)
- `packages/renderer/src/types/desktop.d.ts` (renderer 侧类型)

## 具体任务
1. 确认 preload.ts 编译输出到正确路径
2. 确认 contextBridge.exposeInMainWorld("desktop", api) 正常注入
3. 对齐 @ftre/shared 和 renderer 的 DesktopAPI 类型定义

## 验收标准
- renderer console: `typeof window.desktop` === 'object'
- `window.desktop.fs`, `window.desktop.git` 等子对象存在

## 前置依赖
TODO-1.2

## 预估难度
低
