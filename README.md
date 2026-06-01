# ftre-desktop

> AI Agent 桌面客户端 | Electron + React + TypeScript

## 简介

ftre 是一个 AI Agent 桌面应用，提供终端、编辑器、文件管理、Git 集成等功能，支持与 AI 后端服务协作。

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Electron 33 |
| 前端 | React + TypeScript + Vite |
| UI | Tailwind CSS + Monaco Editor |
| 包管理 | pnpm (monorepo) |
| 构建 | tsc + tsup + Vite + electron-builder |

## 项目结构

```
ftre-desktop/
├── packages/
│   ├── electron/       # Electron 主进程 + IPC
│   ├── renderer/       # React 前端渲染进程
│   ├── shared/         # 共享类型与工具
│   ├── ui/             # UI 组件库
│   ├── editor/         # 编辑器封装
│   └── virtual-list/   # 虚拟列表
├── backend/            # 后端 Python 代码（不打包进纯客户端）
├── scripts/            # 辅助脚本
└── release/            # 构建产物
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建前端
pnpm build

# 打包纯客户端 (dir 模式，用于验证)
pnpm pack

# 打包纯客户端 exe
pnpm dist
```

## 打包说明

| 命令 | 产物 | 说明 |
|------|------|------|
| `pnpm pack` | `release/win-unpacked/` | 解包目录，快速验证 |
| `pnpm dist` | `release/ftre Setup X.X.X.exe` | NSIS 安装包（纯客户端，~88MB） |

纯客户端打包包含：
- Electron 主进程
- React 渲染前端
- 共享模块
- node-pty 终端

**不含后端**（Python 运行时、后端代码等）。如需后端打包，使用 `pnpm dist:full`。

## 窗口标题

在 `packages/electron/src/window.ts` 中配置，当前为 `ftre`。

## 许可证

MIT
