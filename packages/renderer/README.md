# @ftre/renderer

> React 渲染进程 — FTRE Desktop 的用户界面层

## 📖 历史

`@ftre/renderer` 包是 FTRE Desktop 项目的前端实现，从项目初期就是整个应用的核心 UI 层。它最初承载了所有前端功能，包括：

- **编辑器** — Monaco Editor 集成与状态管理
- **文件浏览器** — 项目文件树导航
- **终端** — xterm.js 终端模拟器
- **AI 聊天** — 与 AI Agent 的对话界面
- **全局搜索** — 文件与内容搜索

随着项目规模增长，我们进行了架构重构：

1. **类型定义抽取** — 共享类型迁移到 `@ftre/shared`
2. **编辑器独立** — Monaco 相关代码迁移到 `@ftre/editor`

现在，`@ftre/renderer` 作为"宿主应用"，集成各个独立包并提供完整的 IDE 体验。

## 🎯 定位

`@ftre/renderer` 是 FTRE Desktop 的**展示层和交互层**，设计原则：

- **组件化** — 基于 React 的模块化 UI 架构
- **状态集中** — 使用 Zustand 管理全局状态
- **特性隔离** — 按功能域划分 features
- **测试覆盖** — 关键组件和 store 有测试保障

## 🏗 架构

```
@ftre/renderer/
├── src/
│   ├── app/              # 应用级组件
│   │   ├── App.tsx       # 根组件
│   │   ├── Workbench.tsx # 主工作台
│   │   ├── TitleBar.tsx  # 标题栏
│   │   └── StatusBar.tsx # 状态栏
│   │
│   ├── features/         # 功能模块
│   │   ├── editor/       # 编辑器集成
│   │   ├── explorer/     # 文件浏览器
│   │   ├── terminal/     # 终端
│   │   ├── chat/         # AI 聊天
│   │   ├── search/       # 搜索面板
│   │   ├── git/          # Git 集成
│   │   ├── activity-bar/ # 活动栏
│   │   ├── bottom-panel/ # 底部面板
│   │   └── ...
│   │
│   ├── stores/           # Zustand 状态
│   │   ├── editor.ts     # 编辑器状态
│   │   ├── chat.ts       # 聊天状态
│   │   ├── workspace.ts  # 工作区状态
│   │   ├── terminal.ts   # 终端状态
│   │   ├── layout.ts     # 布局状态
│   │   └── ...
│   │
│   ├── components/       # 通用组件
│   │   ├── ContextMenu.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── ...
│   │
│   ├── services/         # 服务层
│   │   ├── stream-manager.ts
│   │   └── global-event-stream.ts
│   │
│   ├── hooks/            # 自定义 Hooks
│   ├── lib/              # 工具库
│   ├── styles/           # 全局样式
│   └── types/            # 类型定义
│
├── index.html
└── vite.config.ts
```

### 核心模块

#### `app/` — 应用框架

```
┌─────────────────────────────────────────────────────┐
│                    TitleBar                         │
├──────────┬──────────────────────────┬───────────────┤
│          │                          │               │
│ Activity │        Workbench         │    Chat       │
│   Bar    │   ┌──────────────────┐   │    Panel      │
│          │   │   EditorArea     │   │               │
│          │   │                  │   │               │
│          │   ├──────────────────┤   │               │
│          │   │   BottomPanel    │   │               │
│          │   │  (Terminal/...)  │   │               │
│          │   └──────────────────┘   │               │
├──────────┴──────────────────────────┴───────────────┤
│                    StatusBar                        │
└─────────────────────────────────────────────────────┘
```

#### `features/editor/` — 编辑器集成

与 `@ftre/editor` 包集成：

```typescript
// EditorArea.tsx
import { MonacoEditor, MonacoDiffViewer, DiffBar } from "@ftre/editor/ui";

// editor-host-bridge.ts
import { registerHostBridge } from "@ftre/editor/runtime";

registerHostBridge({
  readFile: (path) => window.desktop.fs.readFile(path),
  writeFile: (path, content) => window.desktop.fs.writeFile(path, content),
  // ...
});
```

#### `features/chat/` — AI 聊天

与 AI Agent 的对话界面：

- `ChatPanel.tsx` — 聊天面板容器
- `MessageList.tsx` — 消息列表
- `ChatInput.tsx` — 输入框组件
- `ToolCallCard.tsx` — 工具调用展示
- `toolActions.ts` — 工具执行逻辑

#### `features/terminal/` — 终端

基于 xterm.js 的终端模拟器：

- `TerminalPanel.tsx` — 终端面板
- `TerminalTab.tsx` — 终端标签页
- 支持多终端实例

#### `stores/` — 状态管理

使用 Zustand 进行状态管理：

```typescript
// editor.ts — 编辑器状态（使用 @ftre/editor 核心）
export const useEditor = create<EditorStore>((set, get) => ({
  ...createInitialEditorState(),
  ...createEditorActions(set, get),
}));

// chat.ts — 聊天状态
export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  addUserMessage: (content) => { ... },
  // ...
}));

// workspace.ts — 工作区状态
export const useWorkspace = create<WorkspaceState>((set) => ({
  rootPath: null,
  setRootPath: (path) => set({ rootPath: path }),
}));
```

## 📦 依赖

### 核心依赖

| 包 | 用途 |
|---|---|
| `react` | UI 框架 |
| `zustand` | 状态管理 |
| `@ftre/editor` | 编辑器核心 |
| `@ftre/shared` | 共享类型 |
| `@monaco-editor/react` | Monaco 编辑器 |
| `@xterm/xterm` | 终端模拟器 |
| `lucide-react` | 图标库 |
| `tailwindcss` | CSS 框架 |
| `framer-motion` | 动画库 |
| `react-markdown` | Markdown 渲染 |

### 开发依赖

| 包 | 用途 |
|---|---|
| `vite` | 构建工具 |
| `vitest` | 测试框架 |
| `@testing-library/react` | React 测试 |

## 🎨 样式系统

使用 Tailwind CSS + 自定义设计令牌：

```css
/* 颜色系统 */
--color-surface: #1e1e1e;
--color-base: #252526;
--color-elevated: #2d2d2d;
--color-neon: #00ff88;

/* 文本颜色 */
--color-t-primary: #ffffff;
--color-t-secondary: #cccccc;
--color-t-muted: #858585;
```

## 🛠 开发

```bash
# 开发模式
pnpm --filter @ftre/renderer dev

# 构建
pnpm --filter @ftre/renderer build

# 测试
pnpm --filter @ftre/renderer test

# 测试监听模式
pnpm --filter @ftre/renderer test:watch
```

### 开发服务器

Vite 开发服务器运行在 `http://localhost:5173`，主进程会自动加载此地址。

### 测试

使用 Vitest + Testing Library：

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test src/stores/editor.test.ts

# 查看覆盖率
pnpm test -- --coverage
```

## 🔌 IPC 集成

通过 `window.desktop` 访问系统能力：

```typescript
// 文件操作
const { content, language } = await window.desktop.fs.readFile(path);
await window.desktop.fs.writeFile(path, content);

// 终端
const { id } = await window.desktop.terminal.create({ cwd: rootPath });
await window.desktop.terminal.write(id, "ls -la\n");

// Git
const { files } = await window.desktop.git.status(rootPath);
await window.desktop.git.commit(rootPath, "feat: add feature");
```

## 📁 项目结构约定

### 特性模块 (`features/`)

每个特性模块包含：

```
features/example/
├── ExamplePanel.tsx      # 主面板组件
├── ExampleItem.tsx       # 子组件
├── example-utils.ts      # 工具函数
└── index.ts              # 导出
```

### Store (`stores/`)

每个 store 文件包含：

```typescript
// 1. 类型定义
interface ExampleState { ... }

// 2. Store 创建
export const useExample = create<ExampleState>((set, get) => ({ ... }));

// 3. Selector hooks (可选)
export const useExampleValue = () => useExample((s) => s.value);
```

### 测试文件

测试文件与源文件同目录，以 `.test.ts(x)` 结尾：

```
stores/
├── editor.ts
├── editor.test.ts
├── chat.ts
└── chat.test.ts
```

## 📄 许可

私有包，仅供 FTRE Desktop 项目内部使用。