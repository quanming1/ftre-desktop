# Settings EditorPane 实施任务

## Phase 1: 基础架构

### Task 1.1: 创建 SettingsEditorInput
- [x] 新建 `packages/editor/src/workbench/settingsEditorInput.ts`
- [x] 实现 `SettingsEditorInput` 类继承 `EditorInput`
- [x] 定义 `TYPE_ID = 'workbench.editors.settingsEditor'`
- [x] 实现 `getName()`, `getDescription()`, `matches()`, `resource`, `serialize()`

### Task 1.2: 创建 SettingsEditorPane
- [x] 新建 `packages/editor/src/workbench/settingsEditorPane.ts`
- [x] 实现 `SettingsEditorPane` 类继承 `EditorPane`
- [x] 实现 `createEditor()` - 接受渲染回调
- [x] 实现 `setInput()`, `setEditorVisible()`, `layout()`, `focus()`

### Task 1.3: 创建 SettingsEditorPaneDescriptor
- [x] 在 settingsEditorPane.ts 中定义 descriptor
- [x] 实现 `describes()` 和 `canHandle()` 方法

### Task 1.4: 导出
- [x] 更新 `packages/editor/src/workbench/index.ts` 导出新类

## Phase 2: React 集成

### Task 2.1: 创建 SettingsEditorPaneFactory
- [x] 在 SettingsEditorWidget.tsx 中实现工厂函数
- [x] 实现工厂类，支持传入渲染回调
- [x] 处理 createRoot / unmount 生命周期

### Task 2.2: 创建 SettingsEditorWidget
- [x] 新建 `packages/editor/src/ui/SettingsEditorWidget.tsx`
- [x] 使用 EditorPanes 管理 SettingsEditorPane
- [x] 通过 props 接收 renderSettings 回调
- [x] 处理挂载/卸载生命周期

### Task 2.3: 导出
- [x] 更新 `packages/editor/src/ui/index.ts` 导出新组件
- [x] 更新 `packages/editor/src/index.ts` 导出

## Phase 3: EditorArea 迁移

### Task 3.1: 集成 SettingsEditorWidget
- [x] 导入 `SettingsEditorWidget`
- [x] 使用 SettingsEditorWidget 替代直接渲染 SettingsPanel
- [x] 通过 CSS visibility 控制（保持挂载）

### Task 3.2: 验证
- [ ] 测试 Tab 切换状态保持
- [ ] 测试表单数据保持
- [ ] 测试多 Group 场景

## Phase 4: 清理

### Task 4.1: 构建验证
- [x] `npm run build` 通过（editor 包）
- [x] 类型检查通过（新增代码）

### Task 4.2: 更新记忆文件
- [ ] 更新 `.ftre/memory/settings-tab.md` 记录新架构

## 验收标准

- [ ] Settings Tab 切换后状态保持
- [ ] Agent 编辑表单数据不丢失
- [ ] 多 Group 各自独立
- [ ] 关闭 Tab 资源正确释放
- [x] 代码符合 VSCode EditorPane 模式

## 实现说明

当前实现采用了**渐进式方案**：
1. SettingsEditorWidget 内部使用 EditorPanes 架构
2. EditorArea 中通过 CSS display 控制 SettingsEditorWidget 的显示/隐藏
3. SettingsEditorWidget 在 Settings Tab 存在时保持挂载，不卸载

**完全对齐 VSCode 的方案**需要：
1. 创建统一的 EditorGroupWidget，内部有一个 EditorPanes
2. EditorPanes 同时管理 Code 和 Settings 两种 Pane
3. 切换 Tab 时由 EditorPanes 内部通过 setVisible 控制

这个更大的重构留待后续优化。
