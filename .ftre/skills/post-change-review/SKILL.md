---
name: post-change-review
description: |
  代码变更后的错误排查与验证技能。在完成代码修改后，系统化地检查潜在问题。
  触发场景：
  - 完成一个功能开发后需要排查问题
  - 用户报告 BUG 后需要定位原因
  - 代码重构后验证是否引入副作用
  - 修改涉及组件挂载/卸载、状态管理、异步操作等易出错场景
---

# Post-Change Review

完成代码变更后，按以下清单排查潜在问题。

## 检查清单

### 1. 构建验证

```bash
pnpm build 2>&1 | tail -10   # 检查构建错误
npx tsc --noEmit 2>&1 | grep -E "(error|新增文件名)" | head -20  # 类型检查
```

### 2. React 组件生命周期问题

**症状**：组件被意外 unmount/remount，导致状态丢失或重复初始化

**检查点**：
- 条件渲染 `{condition && <Component />}` 是否会导致不必要的 unmount
- `key` 属性变化是否会导致组件重建
- 列表 `map()` 渲染顺序变化是否影响组件身份

**修复模式**：
```tsx
// ❌ 条件渲染会 unmount
{visible && <ExpensiveComponent />}

// ✅ CSS 控制显隐，保持挂载
<div style={{ display: visible ? 'block' : 'none' }}>
  <ExpensiveComponent />
</div>

// ✅ 或用 visibility + pointerEvents
<div style={{ 
  visibility: visible ? 'visible' : 'hidden',
  pointerEvents: visible ? 'auto' : 'none' 
}}>
  <ExpensiveComponent />
</div>
```

### 3. CSS 布局问题

**检查点**：
- flex 子元素是否正确设置 `flex-shrink: 0` 或 `flex: 1`
- 百分比宽度是否相对于正确的父容器
- `order` 属性配合 flex 时，元素高度是否正确

**常见问题**：
```tsx
// ❌ 包裹元素没有高度，子元素塌陷
<div style={{ order: 1 }}>
  <ResizeHandle />  // 高度为 0
</div>

// ✅ 包裹元素继承高度
<div className="h-full" style={{ order: 1 }}>
  <ResizeHandle />
</div>
```

### 4. 拖拽/缩放方向问题

**检查点**：
- 元素位置改变后，拖拽 delta 的正负方向是否仍然正确
- resize handler 是否考虑了元素在不同位置时的方向

**修复模式**：
```tsx
// 根据元素位置调整 delta 方向
const adjustedDelta = isElementOnRight ? -delta : delta;
```

### 5. useEffect 依赖与重复执行

**检查点**：
- 组件重新挂载是否触发了不应重复执行的 effect
- effect 内的条件判断是否足以防止重复操作

**常见问题**：
```tsx
// ❌ 每次 mount 都创建
useEffect(() => {
  createTerminal();
}, [rootPath]);

// ✅ 检查是否已存在
useEffect(() => {
  if (terminalManager.hasTerminals(rootPath)) return;
  createTerminal();
}, [rootPath]);
```

### 6. 第三方库集成问题

**Monaco Editor**：
- 实例被 dispose 后是否还有异步回调访问它
- 组件 unmount 时是否正确清理

**xterm.js**：
- 终端容器 DOM 变化后是否需要 refit
- PTY 进程退出后是否正确清理监听器

**framer-motion**：
- `AnimatePresence` + 条件渲染会 unmount children
- 需要保持 children 挂载时，用 `animate` 控制可见性而非条件渲染

### 7. 状态持久化问题

**检查点**：
- localStorage 读取时是否有迁移逻辑
- 新增字段是否有默认值
- 字段类型变更是否兼容旧数据

```tsx
// 迁移示例
if (!parsed.newField && parsed.oldField) {
  parsed.newField = convertOldToNew(parsed.oldField);
}
```

## 快速诊断流程

1. **看控制台**：有无红色错误、警告
2. **看网络**：有无失败请求（后端未启动？）
3. **看 React DevTools**：组件是否频繁 unmount/remount
4. **二分法**：回滚部分改动定位问题代码

## 常见错误模式速查

| 症状 | 可能原因 | 检查方向 |
|------|----------|----------|
| 组件状态丢失 | unmount/remount | 条件渲染、key 变化 |
| 元素高度为 0 | CSS 继承问题 | 父元素是否设置高度 |
| 拖拽方向反了 | delta 方向 | 元素位置 vs delta 计算 |
| 功能重复执行 | effect 触发 | mount 次数、依赖数组 |
| 第三方库报错 | 生命周期 | dispose 时机、异步回调 |
| 动画后消失 | AnimatePresence | 是否需要保持挂载 |
