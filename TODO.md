# AI IDE 桌面端 - 开发路线图

## 项目定位

基于 Electron + Monaco Editor 的轻量 AI IDE，对标 Cursor 的核心体验：
文件浏览 / 代码编辑 / AI 对话 / 终端。
文件系统操作通过 Electron IPC 直接访问本地磁盘，AI 能力通过 HTTP 与 Python Agent 后端通信。

## 设计原则

- 暗色调为主，不使用 emoji，减少边框
- 用背景色差和间距区分区域，而非线条
- 字体使用等宽字体（JetBrains Mono / Cascadia Code）
- 交互反馈用颜色变化和透明度，不用动画过渡

---

## Phase 0: 工程基础 [完成]

- [x] Electron 主进程（main.js）
- [x] Python 后端生命周期管理（启动/健康检查/关闭）
- [x] preload.js（IPC 桥接：文件系统操作 + 原生对话框）
- [x] 前端工程化搭建
  - 引入构建工具（Vite）
  - TypeScript 配置
  - 目录结构规划
  - 开发模式热更新（Vite dev server + Electron）

目标产物：`npm run dev` 能启动 Electron 窗口并加载 Vite 开发页面

---

## Phase 1: 布局骨架 [完成]

核心布局采用三栏结构：

```
+------------------------------------------+
|              标题栏 (Title Bar)            |
+--------+-------------------+-------------+
|        |                   |             |
| 文件树  |   编辑器区域       |  AI 对话面板 |
| 侧边栏  |   (Monaco)       |             |
|        |                   |             |
| 200px  |   flex: 1         |   360px     |
|        |                   |             |
|        +-------------------+             |
|        |   终端面板          |             |
|        |   (xterm.js)      |             |
+--------+-------------------+-------------+
```

任务清单：
- [x] 安装 UI 依赖（React + Monaco + xterm.js）
- [x] 实现可拖拽分栏组件（SplitPane）
- [x] 左侧边栏容器（可折叠）
- [x] 中间编辑器 + 底部终端的上下分栏
- [x] 右侧 AI 面板容器（可折叠）
- [x] 自定义标题栏（-webkit-app-region: drag）
- [x] 全局 CSS 变量体系（颜色、间距、字号）

目标产物：空的三栏布局能正确渲染和拖拽调整大小

---

## Phase 2: 文件树 [完成]

通过 Electron IPC 直接读取本地文件系统，渲染为树形组件。

前端任务：
- [x] 文件树组件（递归渲染，懒加载子目录）
- [ ] 文件图标（按扩展名映射，用 SVG 图标集）
- [x] 单击预览、双击打开（Tab 固定）
- [ ] 右键菜单（新建文件/文件夹、重命名、删除）
- [x] 当前打开文件高亮
- [x] 工作区路径显示和切换（原生文件夹选择对话框）

目标产物：能浏览工作区目录，点击文件在编辑器中打开

---

## Phase 3: Monaco 编辑器 [完成]

集成 Monaco Editor，实现多 Tab 编辑体验。

任务清单：
- [x] Monaco Editor 集成（@monaco-editor/react）
- [x] Tab 栏组件（打开/关闭/切换）
- [x] 文件修改状态标记（未保存圆点）
- [x] 快捷键保存（Ctrl+S 调 IPC writeFile）
- [x] 语言自动检测（根据文件扩展名）
- [x] 编辑器主题（自定义暗色主题，与整体 UI 统一）
- [ ] 多文件同时打开，切换 Tab 恢复光标位置和滚动位置
- [ ] 欢迎页（无文件打开时显示）
- [ ] Tab 拖拽排序

目标产物：能打开文件、编辑、保存，多 Tab 切换

---

## Phase 4: AI 对话面板 [完成]

将现有聊天功能迁移到右侧面板，对接后端 SSE 流。

任务清单：
- [x] 对话面板组件（消息列表 + 输入框）
- [x] SSE 流处理（TypeScript 重写，React 集成）
- [x] 消息类型渲染
  - 用户消息
  - AI 文本回复（Markdown 渲染）
  - 工具调用卡片（折叠/展开）
- [x] 模型选择器
- [x] 会话管理（新建/清空）
- [x] 停止生成按钮
- [ ] 代码块渲染（语法高亮，一键复制，一键应用到编辑器）
- [ ] Token 用量显示
- [ ] 会话历史列表（切换/删除）

目标产物：能在右侧面板与 AI 对话，看到工具调用过程

---

## Phase 5: 终端面板 [完成]

集成 xterm.js，提供内置终端。

任务清单：
- [x] xterm.js 集成
- [x] 通过 Electron IPC 创建 pty 进程（node-pty）
  - preload 暴露终端 API
  - main 进程管理 pty 生命周期
- [x] 终端面板显示/隐藏切换（StatusBar 按钮）
- [x] 终端主题与编辑器统一
- [ ] 多终端实例（Tab 切换）
- [ ] Ctrl+` 快捷键切换

目标产物：能在 IDE 内打开终端执行命令

---

## Phase 6: AI 与编辑器联动 [完成]

这是区别于普通编辑器的核心能力。

任务清单：
- [x] AI 修改文件后，编辑器自动刷新内容
- [x] Diff 审查栏：AI 修改文件时显示 Accept/Reject 按钮
- [x] 接受/拒绝修改（接受写入磁盘，拒绝回退原内容）
- [x] 编辑器内选中代码 → 右键发送给 AI（Explain / Refactor）
- [x] SSE 中检测 write/edit 工具调用，自动触发文件刷新
- [ ] AI 工具调用时，文件树中高亮被操作的文件
- [ ] 内联代码补全（可选，后期）

目标产物：AI 的文件操作能实时反映在编辑器中，支持 diff 审查

---

## Phase 7: 体验打磨

- [ ] 快捷键体系（Ctrl+P 文件搜索、Ctrl+Shift+F 全局搜索）
- [ ] 命令面板（Ctrl+Shift+P）
- [ ] 文件搜索（IPC 调本地 ripgrep 或 Node.js glob）
- [ ] 面板布局记忆（localStorage 持久化）
- [ ] 窗口标题显示当前文件和工作区
- [ ] 系统托盘
- [ ] 加载状态和错误处理优化

---

## Phase 8: 打包分发

- [ ] electron-builder 配置
- [ ] Python 环境打包策略（内嵌 Python 或要求用户安装）
- [ ] MongoDB 处理（内嵌 mongod 或改用 SQLite）
- [ ] Windows 安装包（NSIS）
- [ ] 自动更新（electron-updater）
- [ ] 应用图标和启动画面

---

## 目录结构

```
packages/desktop/
├── main.js                  # Electron 主进程
├── preload.js               # 预加载脚本（IPC 桥接）
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html               # Vite 入口 HTML
└── src/
    ├── app/                  # 应用入口、路由、全局 Provider
    ├── assets/               # 静态资源（图标 SVG 等）
    ├── components/           # 通用 UI 组件（SplitPane、IconButton 等）
    ├── features/
    │   ├── editor/           # Monaco 编辑器、Tab 管理、主题
    │   ├── explorer/         # 文件树、文件操作
    │   ├── chat/             # AI 对话面板、SSE 处理、消息渲染
    │   ├── terminal/         # xterm.js 终端集成
    │   └── search/           # 文件搜索、全局搜索
    ├── hooks/                # 自定义 React Hooks
    ├── services/             # 后端 API 调用封装（HTTP + SSE）
    ├── stores/               # Zustand 状态管理
    ├── styles/               # 全局 CSS 变量、主题、reset
    └── types/                # TypeScript 类型定义
```

---

## 通信架构

```
Electron Main (Node.js)
├── IPC Handlers: 文件读写、目录浏览、文件夹选择对话框
├── 管理 Python 后端子进程生命周期
└── 终端 pty 管理（node-pty）

渲染进程 (React)
├── 文件树 / 编辑器 / 终端  →  通过 IPC (window.desktop.fs.*)
└── AI 对话面板            →  通过 HTTP + SSE (localhost:9988)

Python FastAPI 后端
├── AI Agent 聊天 (SSE 流)
├── 会话管理
└── 模型管理
```

---

## 技术栈总结

| 层 | 技术 |
|---|------|
| 桌面壳 | Electron |
| 构建 | Vite + TypeScript |
| UI 框架 | React |
| 代码编辑器 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| 状态管理 | Zustand（轻量） |
| 样式 | CSS Modules + CSS 变量 |
| 文件系统 | Electron IPC (Node.js fs) |
| AI 通信 | HTTP REST + SSE (Python FastAPI) |
| 后端 | Python FastAPI（现有） |
| 数据库 | MongoDB / Beanie（现有） |
