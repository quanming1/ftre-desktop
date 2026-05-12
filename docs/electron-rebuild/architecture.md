# FTRE Desktop — Electron 桌面端重建架构文档

## 概述

将当前纯浏览器 WebSocket 客户端改造回 Electron 桌面应用。后端（ai-base gateway）独立运行，Electron 作为外连客户端。保留全部原生能力（文件系统、Git、终端、文件监听、内存监控）。

## 当前状态

项目已有完整 Electron 代码（`packages/electron/`），包含：
- Main process: 窗口创建、IPC 注册、preload bridge
- IPC handlers: fs, git, terminal(node-pty), store, search, watcher, memory
- Preload: `window.desktop` API bridge

WebSocket 重构后，前端改为纯浏览器模式（`pnpm dev` on port 50000）。需要恢复 Electron 加载流程。

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│ Electron App                                         │
│                                                      │
│  ┌─────────────┐        ┌─────────────────────────┐ │
│  │ Main Process │        │ Renderer (BrowserWindow) │ │
│  │              │        │                          │ │
│  │ - IPC fs/git │◀─IPC──▶│ - React UI              │ │
│  │ - node-pty   │        │ - Monaco Editor         │ │
│  │ - file watch │        │ - WS Client (→ gateway) │ │
│  │ - store      │        │ - Stores (Zustand)      │ │
│  │              │        │                          │ │
│  └─────────────┘        └────────────┬────────────┘ │
│                                       │              │
└───────────────────────────────────────┼──────────────┘
                                        │ WebSocket
                                        ▼
                            ┌──────────────────────┐
                            │ ai-base gateway      │
                            │ ws://127.0.0.1:18790 │
                            │ (独立运行)            │
                            └──────────────────────┘
```

## 进程模型

| 进程 | 角色 | 说明 |
|------|------|------|
| Main Process | Node.js | Electron 主进程，管理窗口、IPC 通道、系统交互 |
| Renderer | Chromium | React 前端，通过 preload bridge 调用原生能力 |
| ai-base gateway | Python (外部) | AI 后端，用户独立启动，Electron 通过 WebSocket 连接 |

## 通信层

### 1. Renderer ↔ Main Process (IPC)
- 文件操作: `fs:readDir`, `fs:readFile`, `fs:writeFile`, `fs:delete`, `fs:rename`, ...
- Git: `git:info`, `git:status`, `git:stage`, `git:commit`, ...
- 终端: `pty:create`, `pty:write`, `pty:resize`, `pty:kill`
- 存储: `store:get`, `store:set`
- 搜索: `fs:search`
- 文件监听: `fs:watch`, `fs:unwatch` → push event `fs:fileChanged`
- 内存: `memory:getUsage`

### 2. Renderer ↔ ai-base Gateway (WebSocket)
- 连接: `ws://127.0.0.1:18790/`
- 协议: JSON envelope (`{type, chat_id, content}` → `{event, chat_id, text}`)
- 流式: delta → stream_end → turn_end

## 窗口配置

- 无边框 (frameless) 窗口
- 自定义标题栏 (TitleBar 组件)
- 尺寸: 1280×860 (最小 900×600)
- 背景色: #1e1e1e
- Preload 脚本: contextBridge 暴露 `window.desktop`

## 构建产物

- 目标: Windows x64 exe 安装包 (NSIS)
- appId: `com.ftre.desktop`
- 产品名: `ftre`
- node-pty 需 asarUnpack

## 关键约束

1. **后端外连**: 不内嵌 Python，用户需自行启动 `ai-base gateway`
2. **WS 地址可配**: 支持配置 gateway 地址（默认 127.0.0.1:18790）
3. **离线可用**: IPC 原生功能（文件/Git/终端）在无后端时仍可用
4. **优雅降级**: WS 断连时显示提示，不白屏
