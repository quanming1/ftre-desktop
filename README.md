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

# 打包带内置 Gateway 的 macOS Intel 安装包
pnpm package:mac:x64

# 打包带内置 Gateway 的 macOS Apple Silicon 安装包
pnpm package:mac:arm64
```

## 打包说明

| 命令 | 产物 | 说明 |
|------|------|------|
| `pnpm pack` | `release/win-unpacked/` | 解包目录，快速验证 |
| `pnpm dist` | `release/ftre Setup X.X.X.exe` | NSIS 安装包（纯客户端，~88MB） |
| `pnpm package:mac:x64` | `release/ftre-X.Y.Z-mac-x64.dmg/.zip` | Intel Mac，包含架构匹配的 Python runtime |
| `pnpm package:mac:arm64` | `release/ftre-X.Y.Z-mac-arm64.dmg/.zip` | Apple Silicon，包含架构匹配的 Python runtime |

纯客户端打包包含：
- Electron 主进程
- React 渲染前端
- 共享模块
- node-pty 终端

**不含后端**（Python 运行时、后端代码等）。如需 Windows 自包含安装包，使用
`pnpm package:win`；该命令会先准备 Python、ftre、ftre-agent-core 和 cordis-py。

Mac 发布命令会先执行 `scripts/bundle-backend.js`，把 ftre、ftre-agent-core、
依赖和对应架构的 Python runtime 放入安装包。用户安装发布包时不需要预装
Python、Node.js、Homebrew、conda、Git 或项目源码；只有 macOS 版本、CPU
架构、磁盘空间和系统安装权限等操作系统条件需要满足。

正式 Release 的签名/notarization 由 GitHub Actions 的 Apple 凭据控制；没有凭据
时只能生成 unsigned 测试包，Release 说明必须如实标注，不能把它当作已公证包。

## 窗口标题

在 `packages/electron/src/window.ts` 中配置，当前为 `ftre`。

## Git 分支

| 分支 | 用途 |
|------|------|
| `master` | **主分支**，稳定代码 |
| `develop` | 开发集成 |
| `feat/*` / `feature/*` | 功能分支 |

## 许可证

MIT
