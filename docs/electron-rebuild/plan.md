# FTRE Desktop — Electron 重建实施计划

## 阶段概览

| 阶段 | 目标 | 预估 |
|------|------|------|
| Phase 1 | 基础骨架 — Electron 窗口跑起来，加载前端页面 | 核心 |
| Phase 2 | IPC 通道 — 恢复 `window.desktop` 全部原生能力 | 核心 |
| Phase 3 | 构建流水线 — dev 模式 + production 打包 | 核心 |
| Phase 4 | 连接层 — WS 连接管理 + 断连 UI | 增强 |
| Phase 5 | 打包发布 — electron-builder 出 exe 安装包 | 发布 |

---

## Phase 1: 基础骨架

### TODO-1.1: 修复 Electron main.ts 入口
- **文件**: `packages/electron/src/main.ts`
- **内容**: 检查并修复 app ready → createWindow 流程
- **验收**: `electron packages/electron/dist/main.js` 能弹出空窗口

### TODO-1.2: 修复 window.ts 窗口创建
- **文件**: `packages/electron/src/window.ts`
- **内容**: 确保 dev 模式加载 `http://localhost:50000`，production 加载 `renderer/dist/index.html`
- **验收**: 窗口正确加载前端页面（含 TitleBar）

### TODO-1.3: 修复 preload.ts 编译
- **文件**: `packages/electron/src/preload.ts`
- **内容**: 确保 preload 能正常编译，contextBridge 正常注入 `window.desktop`
- **验收**: renderer console 中 `typeof window.desktop` === 'object'

### TODO-1.4: 修复 dev 启动脚本端口不一致
- **文件**: 根 `package.json`
- **内容**: `wait-on` 检查端口从 5173 改为 50000（与 vite.config.ts 一致）
- **验收**: `pnpm dev` 能依次启动 renderer + electron

---

## Phase 2: IPC 通道恢复

### TODO-2.1: 注册所有 IPC handlers
- **文件**: `packages/electron/src/main.ts` → 调用 `registerXxxHandlers()`
- **内容**: 确认 fs/git/terminal/store/search/watcher/memory 所有 handler 注册正确
- **验收**: main process 启动无报错

### TODO-2.2: 修复文件系统 IPC
- **文件**: `packages/electron/src/ipc/fs.ts`
- **内容**: 确认 `fs:readDir`, `fs:readFile`, `fs:writeFile`, `fs:selectFolder` 等全部正常
- **验收**: 前端打开文件夹 → 文件树正确显示

### TODO-2.3: 修复 Git IPC
- **文件**: `packages/electron/src/ipc/git.ts`
- **内容**: 确认 `git:info`, `git:status`, `git:stage`, `git:commit` 等正常
- **验收**: 侧栏 Git Changes 面板显示正确状态

### TODO-2.4: 修复终端 IPC (node-pty)
- **文件**: `packages/electron/src/ipc/terminal.ts`
- **内容**: 确认 `pty:create`, `pty:write`, `pty:resize` + push events 正常
- **验收**: 底部终端面板可打开、输入命令、看到输出

### TODO-2.5: 修复 Store IPC
- **文件**: `packages/electron/src/ipc/store.ts`
- **内容**: 确认 `store:get`, `store:set` 读写 JSON 文件正常
- **验收**: 窗口关闭后重开，工作区路径等状态保留

### TODO-2.6: 修复文件搜索 IPC
- **文件**: `packages/electron/src/ipc/search.ts` + `workers/search.ts`
- **内容**: 确认 worker thread 搜索正常
- **验收**: 全局搜索面板能搜到文件内容

### TODO-2.7: 修复文件监听 IPC
- **文件**: `packages/electron/src/ipc/watcher.ts`
- **内容**: 确认 `fs:watch` → `fs:fileChanged` push 事件正常
- **验收**: 外部修改文件 → 前端自动刷新文件树

### TODO-2.8: 修复内存监控 IPC
- **文件**: `packages/electron/src/ipc/memory.ts`
- **内容**: 确认 `memory:getUsage` 返回正确数据
- **验收**: 内存监控面板显示进程内存信息

---

## Phase 3: 构建流水线

### TODO-3.1: 修复 @ftre/electron 的 tsc 编译
- **文件**: `packages/electron/tsconfig.json` + `package.json`
- **内容**: 确保 `pnpm build` 在 electron 包下能编译出 `dist/main.js`, `dist/preload.js`
- **验收**: `packages/electron/dist/` 下有正确输出

### TODO-3.2: 修复根 dev 脚本并发启动
- **文件**: 根 `package.json`
- **内容**: 修复 concurrently 配置 — shared → editor → renderer + electron 并发
- **验收**: `pnpm dev` 一键启动，Electron 窗口自动弹出加载前端

### TODO-3.3: 修复 renderer production build
- **文件**: `packages/renderer/vite.config.ts`
- **内容**: 确保 `vite build` 产出正确（base="./"），Electron 能以 file:// 加载
- **验收**: `pnpm build` 后 Electron 加载 dist/index.html 正常

---

## Phase 4: 连接层增强

### TODO-4.1: Gateway 连接状态 UI
- **文件**: `packages/renderer/src/services/websocket-client.ts` + 新增 UI 组件
- **内容**: WS 断连时在 UI 显示明确提示（"未连接 AI 后端"），而非白屏或静默失败
- **验收**: 不启动 gateway → 打开 app → 看到断连提示

### TODO-4.2: Gateway 地址可配置
- **文件**: `packages/renderer/src/services/websocket-client.ts` + 设置面板
- **内容**: 支持在设置面板中配置 gateway 地址（默认 ws://127.0.0.1:18790/）
- **验收**: 设置面板修改地址 → WS 重连到新地址

### TODO-4.3: IPC 功能离线可用
- **文件**: renderer 各 feature 组件
- **内容**: 确认 WS 断连时文件/Git/终端/编辑器等 IPC 功能仍正常工作
- **验收**: 不启动 gateway → 文件树/编辑器/终端全部正常

---

## Phase 5: 打包发布

### TODO-5.1: 修复 electron-builder 配置
- **文件**: 根 `package.json` 的 `build` 字段
- **内容**: 确认 files、asarUnpack (node-pty)、NSIS 配置正确
- **验收**: `pnpm pack:quick` 打出 unpacked 目录

### TODO-5.2: 处理 node-pty native module
- **文件**: 根 `package.json` + 可能需要 `electron-rebuild`
- **内容**: 确保 node-pty 为 Electron 版本重编译 native addon
- **验收**: 打包后终端功能正常

### TODO-5.3: 生成 NSIS 安装包
- **文件**: electron-builder 配置
- **内容**: `pnpm dist` 打出 exe 安装包
- **验收**: 双击 exe → 安装 → 启动 → 全部功能正常

### TODO-5.4: 桌面快捷方式 + 一键启动脚本
- **文件**: NSIS 配置 或 附带 bat 脚本
- **内容**: 安装后桌面创建快捷方式；附带启动 gateway 的 bat
- **验收**: 用户双击快捷方式即可使用

---

## 依赖关系

```
TODO-1.1 ──→ TODO-1.2 ──→ TODO-1.3 ──→ TODO-1.4
                                          │
                                          ▼
TODO-2.1 → TODO-2.2 → TODO-2.3 → TODO-2.4 → TODO-2.5 → TODO-2.6 → TODO-2.7 → TODO-2.8
                                                                                   │
                                                                                   ▼
                                          TODO-3.1 → TODO-3.2 → TODO-3.3
                                                                    │
                                                                    ▼
                                          TODO-4.1 → TODO-4.2 → TODO-4.3
                                                                    │
                                                                    ▼
                                          TODO-5.1 → TODO-5.2 → TODO-5.3 → TODO-5.4
```

Phase 内部的 TODO 按顺序执行。Phase 之间有前置依赖（Phase N 完成才能开始 Phase N+1）。
