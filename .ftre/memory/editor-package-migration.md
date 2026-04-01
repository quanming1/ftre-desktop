# 编辑器独立包拆分

> 将编辑器子系统从 `@ftre/renderer` 拆分为独立的 `@ftre/editor` 包，以解决性能、耦合和维护性问题。

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor` | 独立编辑器包 (`@ftre/editor`) |
| `packages/editor/src/core/editor-core.ts` | 非响应式编辑器核心（内容缓存、实例注册、视图状态） |
| `packages/editor/src/runtime/host-bridge.ts` | 宿主桥接接口（解耦编辑器与宿主通信） |
| `packages/editor/src/runtime/save-file.ts` | 文件保存统一入口（已迁移完成） |
| `packages/editor/src/ui/theme-registry.ts` | Monaco 主题注册（已迁移完成） |
| `packages/editor/src/store/types.ts` | 编辑器类型定义（OpenFile, DiffEntry, EditorGroup 等） |
| `packages/editor/src/utils/path-utils.ts` | 路径工具函数（workspaceHash） |
| `packages/renderer/src/features/editor/editor-host-bridge.ts` | 宿主桥接实现（连接 renderer store 和 IPC） |

## 业务流程

### 渐进迁移计划 (当前状态)
1. **Phase 0**: 创建 `packages/editor` 包 (**已完成**)
2. **Phase 1**: 迁移 `editorCore` 及核心内核 (**已完成** - 内容/实例/视图状态管理已移至新包)
3. **Phase 2**: 迁移运行时 pipeline (**已完成** - `saveFile` 已迁移，引入 `HostBridge` 接口模式)
4. **Phase 3**: 迁移 Monaco UI 组件 (`MonacoEditor`, `MonacoDiffViewer`, `EditorArea`)
   - **部分完成**: `themeRegistry` 已迁移至 `ui` 层
   - **暂缓**: Monaco 组件因依赖宿主 store 太重，暂留 renderer
5. **Phase 4**: 迁移标签与导航 UI (`TabBar`, `Breadcrumb`, `DiffBar`)
   - **部分完成**: 类型定义已迁移到 `store` 层
   - **暂缓**: UI 组件和 store 实现因深度耦合暂留 renderer
6. **Phase 5**: 收口 editor store 和状态管理（**风险最高，下一步待办**）

### 宿主通信链路
```
renderer (宿主) → registerHostBridge() → @ftre/editor (消费方)
@ftre/editor → getHostBridge() → renderer 实现
```

## 关键数据结构

### HostBridge 接口 (最新)
```typescript
interface HostBridge {
  // 文件系统
  readFile(path: string): Promise<{ content: string; language: string; error?: string }>;
  writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }>;
  showSaveDialog(opts?: { defaultName?: string }): Promise<{ path: string | null }>;
  
  // 持久化存储
  storeGet(key: string): Promise<{ value: unknown }>;
  storeSet(key: string, value: unknown): Promise<void>;
  
  // 编辑器状态  
  openFile(meta: { path: string; name: string; language: string; content: string }): void;
  closeFile(path: string): void;
  markSaved(path: string): void;
  
  // 通知
  notifyError(message: string): void;
}
```

### 新包分层架构 (当前)
- **Core 层**: `editor-core`, `content-cache`, `instance-registry`, `view-state` (非响应式内核)
- **Runtime 层**: `host-bridge`, `save-file`, `open-file`, `hydrate-file` (运行时协调)
- **Store 层**: `types.ts` (**仅包含类型定义**), store 实现暂留 renderer
- **UI 层**: `theme-registry` (主题注册，已迁移)，React 组件待迁移
- **Utils 层**: `path-utils` (workspaceHash 等工具函数)

## 设计决策

- **拆分原因**: 解决 Monaco 冷启动慢、文件打开链路不清晰、竞态问题难定位、业务与编辑器逻辑耦合等问题。
- **迁移策略**: 采用渐进式迁移，优先迁移非响应式核心和关键运行时链路，降低风险。
- **HostBridge 模式**: 编辑器包通过接口与宿主通信，避免直接依赖 renderer 的 store 或 IPC，实现真正的解耦。
- **架构原则**: 让非 React 核心下沉，UI 组件变薄，宿主仅通过明确接口消费编辑器能力。
- **渐进保留**: 对于依赖过重的组件（如 TabBar, Breadcrumb），采用"先迁移轻量部分（类型、工具函数），重耦合部分（store 实现、UI 组件）暂缓"的策略。
- **风险控制**: Phase 5（迁移 store 实现）风险最高，在前面阶段稳定后再进行。

## 注意事项

- 迁移过程中需保证核心功能（打开、保存、切换、diff、外部文件变化刷新）不回归。
- 必须为每个迁移阶段补充关键的回归测试，特别是文件打开链路和缓存生命周期。
- 警惕"只挪目录，不收边界"的风险，确保逻辑真正解耦而非简单文件移动。
- 应用启动时必须在 `main.tsx` 中调用 `registerHostBridge()` 初始化桥接层。
- `monaco-setup.ts` 因使用 Vite `?worker` 语法，需保留在 renderer 包中。
- 类型定义应统一放在 `@ftre/editor/store` 中，renderer 通过 re-export 使用。