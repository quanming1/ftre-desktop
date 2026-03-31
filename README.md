# ftre-desktop

ftre 的桌面客户端，基于 Electron + React + TypeScript 构建。

## 背景

ftre 是一个本地运行的 AI 编程助手。`ftre-desktop` 是它的前端部分，提供：

- 代码编辑器（Monaco Editor）
- 文件浏览器
- 聊天界面（与 AI Agent 交互）
- Git 集成
- 终端
- 多工作区支持

从 [ai-base](https://github.com/quanming1/ai-base) 项目的 `packages/desktop` 抽取而来。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Electron 34 |
| 前端 | React 18 + TypeScript |
| 状态管理 | Zustand |
| 构建 | Vite |
| 编辑器 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| 样式 | TailwindCSS |

## 目录结构

```
ftre-desktop/
├── src/
│   ├── app/              # Electron 主进程
│   │   ├── main.ts       # 入口
│   │   ├── ipc/          # IPC 处理
│   │   └── services/     # 主进程服务（terminal、git 等）
│   ├── components/       # React 组件
│   │   ├── chat/         # 聊天相关
│   │   ├── editor/       # 编辑器相关
│   │   ├── explorer/     # 文件浏览器
│   │   └── ui/           # 通用 UI 组件
│   ├── features/         # 功能模块
│   ├── hooks/            # React Hooks
│   ├── services/         # 渲染进程服务
│   │   ├── api.ts        # 后端 API 调用
│   │   ├── sse.ts        # SSE 事件流
│   │   └── stream-manager.ts  # 流式响应管理
│   ├── stores/           # Zustand stores
│   │   ├── chat.ts       # 聊天状态
│   │   ├── editor.ts     # 编辑器状态
│   │   └── session.ts    # 会话状态
│   ├── types/            # TypeScript 类型定义
│   └── utils/            # 工具函数
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

## 安装

```bash
# 克隆
git clone https://github.com/quanming1/ftre-desktop.git
cd ftre-desktop

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

## 本地开发

### 前置条件

- Node.js >= 18
- pnpm
- 后端服务运行中（默认 http://localhost:23333）

### 开发流程

```bash
# 启动开发服务器（热更新）
pnpm dev

# 修改代码后自动刷新
```

### 与后端联调

默认连接 `http://localhost:23333`，可在 `src/services/api.ts` 中修改。

## 架构说明

### 主进程 vs 渲染进程

| 主进程 (app/) | 渲染进程 (其他) |
|---|---|
| 文件系统操作 | UI 渲染 |
| 终端 (node-pty) | 状态管理 |
| Git 操作 | API 调用 |
| 窗口管理 | 用户交互 |

通过 IPC 通信（`contextBridge` 暴露安全 API）。

### 状态管理

使用 Zustand，按功能拆分 store：

- `session.ts` — 会话列表、当前会话
- `chat.ts` — 聊天消息、流式状态
- `editor.ts` — 打开的文件、编辑状态

### 流式响应

后端通过 SSE 推送事件，`stream-manager.ts` 负责：

- 管理多个会话的流式状态
- 缓冲后台会话的事件
- 切换会话时回放事件

## 相关项目

- [ai-base](https://github.com/quanming1/ai-base) — ftre 后端
- [ftre-agent-core](https://github.com/quanming1/ftre-agent-core) — Agent 框架核心

## License

MIT
