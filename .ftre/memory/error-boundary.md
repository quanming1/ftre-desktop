# Error Boundary 错误边界

> 防止组件渲染错误导致整个 App 崩溃的双层级错误处理方案

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/ui/src/components/ErrorBoundary.tsx` | Error Boundary 组件实现 |
| `packages/ui/src/components/index.ts` | 导出 ErrorBoundary |
| `packages/renderer/src/app/main.tsx` | 应用级 ErrorBoundary 包裹 App |
| `packages/renderer/src/app/Workbench.tsx` | 区域级 ErrorBoundary 包裹各面板 |

## 组件设计

### 双层级模式

```typescript
// 应用级 - 全屏居中展示
<ErrorBoundary level="app">
  <App />
</ErrorBoundary>

// 区域级 - 局部面板/组件错误（默认）
<ErrorBoundary level="region">
  <Panel />
</ErrorBoundary>
```

### Props 接口

```typescript
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;        // 自定义错误 UI
  onError?: (error, errorInfo) => void;  // 错误回调（可用于上报）
  onReset?: () => void;        // 重试时回调
  level?: "app" | "region";    // 层级模式，默认 region
}
```

### 视觉设计

- **主背景**：ftre 深色主题
- **错误强调**：`#f85149` 红色渐变指示条
- **主按钮**：霓虹绿 `#00ff88`（重试按钮）
- **布局**：
  - `app` 级：固定居中、最大宽度 560px
  - `region` 级：占据父容器全尺寸

### 交互功能

1. **重试按钮** — 重置错误状态，重新渲染子组件
2. **复制错误** — 一键复制完整错误信息到剪贴板
3. **查看/隐藏详情** — 展开/折叠错误堆栈（Error Stack + Component Stack）

## 业务流程

### 应用启动
`packages/ui/src/components/ErrorBoundary` → `packages/renderer/src/app/main.tsx`（包裹 App）

### 面板渲染
`packages/ui/src/components/ErrorBoundary` → `packages/renderer/src/app/Workbench.tsx`（包裹 Sessions/Sidebar/Editor/Chat 面板）

## 注意事项

- ErrorBoundary 只能捕获子组件**渲染阶段**的错误，不捕获事件处理、异步代码中的错误
- `level="app"` 时错误 UI 居中全屏显示，适合根级保护
- `level="region"` 时错误 UI 填充父容器，适合面板/组件局部保护
- 错误详情包含 `error.stack` 和 `errorInfo.componentStack`，便于定位问题
