# @ftre/shared

> 共享类型定义 — FTRE Desktop 的跨包契约层

## 📖 历史

`@ftre/shared` 包是 FTRE Desktop Monorepo 中最早创建的基础包之一。它的诞生源于一个简单的需求：**Electron 主进程和渲染进程需要共享类型定义**。

在项目初期，IPC 通信的类型定义散落在各个包中：

- 主进程定义了 IPC handler 的参数和返回值
- 渲染进程定义了 `window.desktop` API 的类型
- 两边的定义需要手动保持同步

这种方式带来了维护负担和潜在的类型不一致问题。于是，我们创建了 `@ftre/shared` 包作为**单一事实来源**，集中管理所有跨进程共享的类型定义。

随着项目演进，这个包的职责保持精简：**只包含类型定义和常量，不包含任何运行时代码**。

## 🎯 定位

`@ftre/shared` 是 FTRE Desktop 的**契约层**，设计原则：

- **零运行时** — 只导出类型，不增加 bundle 体积
- **单一来源** — 所有跨包类型的唯一定义位置
- **稳定接口** — 接口变更需要同时考虑所有消费者
- **文档化** — 类型定义即文档

## 🏗 架构

```
@ftre/shared/
├── src/
│   ├── index.ts    # 导出入口
│   └── types.ts    # 类型定义
└── dist/
    ├── index.js    # 编译输出 (空)
    └── index.d.ts  # 类型声明
```

### 核心类型

#### `FileEntry` — 文件条目

```typescript
interface FileEntry {
  name: string;      // 文件名
  path: string;      // 完整路径
  isDir: boolean;    // 是否为目录
  ext: string | null; // 文件扩展名
}
```

#### `DesktopFS` — 文件系统 API

```typescript
interface DesktopFS {
  readDir(dirPath: string): Promise<{ entries: FileEntry[]; error?: string }>;
  readFile(filePath: string): Promise<{ content: string; language: string; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
  selectFolder(): Promise<{ path: string | null }>;
  showSaveDialog(opts?: { defaultName?: string }): Promise<{ path: string | null }>;
  search(rootPath: string, query: string, options: any): Promise<{ results: any[]; error?: string }>;
  createFile(filePath: string): Promise<{ success: boolean; error?: string }>;
  createFolder(dirPath: string): Promise<{ success: boolean; error?: string }>;
  rename(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }>;
  delete(targetPath: string, isDir: boolean): Promise<{ success: boolean; error?: string }>;
  revealInExplorer(targetPath: string): Promise<void>;
  watch(filePath: string): Promise<void>;
  unwatch(filePath: string): Promise<void>;
  onFileChanged(callback: (filePath: string) => void): () => void;
}
```

#### `DesktopGit` — Git API

```typescript
interface GitInfo {
  branch: string | null;
  changedFiles: number;
  isGitRepo: boolean;
}

interface GitFileStatus {
  path: string;
  oldPath?: string;        // 重命名时的旧路径
  absolutePath: string;
  status: "modified" | "untracked" | "deleted" | "added" | "renamed" | "conflict";
  staged: boolean;
  isDir: boolean;
}

interface DesktopGit {
  info(rootPath: string): Promise<GitInfo>;
  status(rootPath: string): Promise<{ files: GitFileStatus[]; error?: string }>;
  stage(rootPath: string, filePath: string): Promise<{ success: boolean; error?: string }>;
  stageMany(rootPath: string, filePaths: string[]): Promise<{ success: boolean; error?: string }>;
  unstage(rootPath: string, filePath: string): Promise<{ success: boolean; error?: string }>;
  unstageMany(rootPath: string, filePaths: string[]): Promise<{ success: boolean; error?: string }>;
  commit(rootPath: string, message: string): Promise<{ success: boolean; error?: string }>;
  show(rootPath: string, filePath: string): Promise<{ content: string; error?: string }>;
  diffFile(rootPath: string, filePath: string, status: string, staged: boolean, oldPath?: string): Promise<{ original: string; modified: string; error?: string }>;
}
```

#### `DesktopTerminal` — 终端 API

```typescript
interface DesktopTerminal {
  create(opts?: { cols?: number; rows?: number; cwd?: string; shell?: string }): Promise<{ id: number }>;
  write(id: number, data: string): Promise<void>;
  resize(id: number, cols: number, rows: number): Promise<void>;
  kill(id: number): Promise<void>;
  onData(callback: (id: number, data: string) => void): () => void;
  onExit(callback: (id: number, exitCode: number) => void): () => void;
}
```

#### `DesktopStore` — 持久化存储 API

```typescript
interface DesktopStore {
  get(key: string): Promise<{ value: unknown }>;
  set(key: string, value: unknown): Promise<{ success: boolean }>;
}
```

#### `DesktopWindow` — 窗口控制 API

```typescript
interface DesktopWindow {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  getPosition(): Promise<[number, number]>;
  setPosition(x: number, y: number): Promise<void>;
  isMaximized(): Promise<boolean>;
}
```

#### `DesktopAPI` — 完整 API 聚合

```typescript
interface DesktopAPI {
  platform: string;
  isElectron: boolean;
  openExternal(url: string): Promise<void>;
  fs: DesktopFS;
  git: DesktopGit;
  store: DesktopStore;
  window: DesktopWindow;
  terminal: DesktopTerminal;
}

// 全局类型扩展
declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
```

## 📦 使用方式

### 在其他包中引用

```json
// package.json
{
  "dependencies": {
    "@ftre/shared": "workspace:*"
  }
}
```

### 导入类型

```typescript
import type { FileEntry, DesktopFS, GitFileStatus } from "@ftre/shared";

function processFiles(entries: FileEntry[]) {
  return entries.filter(e => !e.isDir);
}
```

### 访问全局 API

由于 `@ftre/shared` 扩展了全局 `Window` 接口，在任何包中都可以直接使用：

```typescript
// 不需要额外导入，类型自动可用
const { content } = await window.desktop.fs.readFile(path);
const { branch } = await window.desktop.git.info(rootPath);
```

## 🔗 依赖关系

```
@ftre/shared (基础层)
     ↑
     ├── @ftre/electron (主进程实现)
     ├── @ftre/renderer (渲染进程消费)
     └── @ftre/editor   (编辑器包消费)
```

所有其他包都依赖 `@ftre/shared`，但 `@ftre/shared` 不依赖任何内部包。

## 🛠 开发

```bash
# 编译
pnpm --filter @ftre/shared build

# 监听模式
pnpm --filter @ftre/shared dev

# 清理构建产物
pnpm --filter @ftre/shared clean
```

### 添加新类型

1. 在 `src/types.ts` 中定义新类型
2. 在 `src/index.ts` 中导出
3. 运行 `pnpm build` 生成声明文件
4. 在消费包中更新实现

### 类型变更注意事项

由于多个包依赖此包，类型变更需要：

- 考虑向后兼容性
- 同步更新 `@ftre/electron` 的实现
- 同步更新 `@ftre/renderer` 的消费代码
- 必要时更新相关测试

## 📁 文件说明

| 文件 | 说明 |
|------|------|
| `src/types.ts` | 所有类型定义 |
| `src/index.ts` | 导出入口 |
| `dist/index.d.ts` | 生成的类型声明 |
| `dist/index.js` | 编译输出 (几乎为空) |

## 🎯 设计决策

### 为什么不用 Protocol Buffers / JSON Schema？

对于 Electron IPC 场景：

- 类型检查在编译期完成，运行时验证不是必需的
- TypeScript 类型足够表达 API 契约
- 无需额外的代码生成步骤
- 保持工具链简单

### 为什么单独成包？

- **避免循环依赖** — electron 和 renderer 互不依赖，通过 shared 共享类型
- **清晰的边界** — 类型定义与实现分离
- **独立版本控制** — 理论上可以独立发布（虽然目前是私有包）

### 为什么不放在根目录？

- 保持 Monorepo 的包结构一致性
- 支持 workspace 协议引用
- 方便配置独立的 tsconfig

## 📄 许可

私有包，仅供 FTRE Desktop 项目内部使用。