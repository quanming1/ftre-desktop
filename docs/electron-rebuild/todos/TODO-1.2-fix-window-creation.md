# TODO-1.2: 修复窗口创建逻辑

## 阶段
Phase 1: 基础骨架

## 状态
- [x] 完成

## 目标
修复 BrowserWindow 创建和页面加载逻辑。

## 涉及文件
- `packages/electron/src/window.ts`
- `packages/electron/src/app-state.ts`

## 具体任务
1. Dev 模式: `mainWindow.loadURL('http://localhost:50000')`
2. Production 模式: `mainWindow.loadFile('renderer/dist/index.html')`
3. 确认 frameless 窗口配置正确（无边框 + 自定义标题栏区域）
4. 设置 webPreferences: contextIsolation=true, preload 路径正确

## 验收标准
- Dev 模式下窗口正确加载 Vite dev server 的页面
- 可以看到 TitleBar 和主界面

## 前置依赖
TODO-1.1

## 预估难度
低
