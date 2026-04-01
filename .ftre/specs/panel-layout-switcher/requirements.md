# 面板布局切换器

> **目标：** 在 TitleBar 右上角添加布局切换按钮，支持三个主面板（文件树、编辑器、Chat）任意拖拽排序，并持久化用户选择。

## 简介

当前 Workbench 有三个主面板：
1. **Sidebar（文件树）** — 固定在最左边
2. **EditorArea（编辑器）** — 中间或右侧
3. **ChatPanel（Chat）** — 中间或右侧

现有的 `splitMode` 只能控制编辑器和 Chat 的左右位置，Sidebar 始终固定。用户希望能自由调整三个面板的排列顺序。

## 术语表

- **面板顺序（panelOrder）**：三个面板从左到右的排列，如 `['sidebar', 'editor', 'chat']`
- **布局切换器（Layout Switcher）**：TitleBar 右上角的按钮，点击弹出拖拽排序面板

## 需求

### 需求 1：布局切换按钮

**用户故事：** 作为用户，我希望在 TitleBar 右上角看到一个布局切换按钮，以便快速调整面板排列。

#### 验收标准

1. THE 布局切换按钮 SHALL 位于 TitleBar 右侧，在悬浮窗按钮（任务、Agent群聊、终端）之前
2. THE 按钮 SHALL 有视觉区分（如分隔线或不同的图标风格），与悬浮窗按钮形成分组
3. THE 按钮 SHALL 使用 `LayoutGrid` 或类似图标表示布局功能
4. WHEN 点击按钮，THE 系统 SHALL 弹出布局排序面板

### 需求 2：拖拽排序面板

**用户故事：** 作为用户，我希望通过拖拽来调整三个面板的位置，直观易用。

#### 验收标准

1. THE 排序面板 SHALL 以 Popover/Dropdown 形式出现在按钮下方
2. THE 面板 SHALL 显示三个可拖拽的卡片，分别代表「文件树」「编辑器」「Chat」
3. WHEN 用户拖拽卡片，THE 卡片 SHALL 跟随鼠标移动并显示插入位置指示器
4. WHEN 用户释放卡片，THE 面板顺序 SHALL 立即更新
5. THE 排序面板 SHALL 在点击外部时自动关闭

### 需求 3：持久化布局选择

**用户故事：** 作为用户，我希望下次打开应用时能恢复上次的面板排列。

#### 验收标准

1. THE 面板顺序 SHALL 保存到 localStorage
2. WHEN 应用启动，THE 系统 SHALL 从 localStorage 恢复面板顺序
3. WHEN 面板顺序改变，THE 系统 SHALL 在 300ms 防抖后自动保存

### 需求 4：布局渲染

**用户故事：** 作为用户，我希望 Workbench 按我设置的顺序渲染三个面板。

#### 验收标准

1. THE Workbench SHALL 根据 `panelOrder` 数组从左到右渲染面板
2. THE 面板之间 SHALL 保留现有的 ResizeHandle 用于调整宽度
3. WHEN `panelOrder` 改变，THE Workbench SHALL 立即重新渲染

## 边界情况

- **默认顺序**：`['sidebar', 'editor', 'chat']`
- **迁移**：现有的 `splitMode` 字段废弃，迁移逻辑将其转换为 `panelOrder`
- **面板隐藏**：如果 Sidebar 隐藏（`activeSidebarView === null`），只渲染剩余两个面板
- **宽度比例**：现有的 `centerRatio` 逻辑需要适配新的三面板结构
