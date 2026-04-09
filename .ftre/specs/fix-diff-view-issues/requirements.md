# 修复 Diff View 相关问题

> **目标：** 修复 Diff 预览视图的多个问题，包括 UI 样式和交互问题

## 简介

Diff 预览视图存在多个问题，影响用户体验。主要问题包括：
1. "跳转到源文件"按钮点击无效
2. UI 样式不美观
3. 可能存在的其他问题

## 术语表

- **DiffBar**: Diff 预览顶部的工具栏组件，显示统计信息和操作按钮
- **MonacoDiffViewer**: 基于 Monaco DiffEditor 的差异对比组件
- **pendingDiffs**: 待处理的 diff 列表，存储在 editor store 中

## 需求

### 需求 1：修复"跳转到源文件"功能

**用户故事：** 作为开发者，我希望点击 DiffBar 的"打开源文件"按钮后，能跳转到源文件并关闭 diff 视图，以便我能编辑文件。

#### 验收标准

1. WHEN 用户点击 DiffBar 的"打开源文件"按钮，THE 编辑器 SHALL 打开对应的源文件
2. WHEN 源文件被打开，THE diff tab SHALL 被关闭或替换为源文件视图

### 需求 2：优化 DiffBar UI 样式

**用户故事：** 作为开发者，我希望 DiffBar 的样式更加美观、信息层次更清晰，以便我能快速理解 diff 信息。

#### 验收标准

1. THE DiffBar SHALL 具有清晰的视觉层次
2. THE 统计信息（+N/-M）SHALL 醒目但不刺眼
3. THE 操作按钮 SHALL 有明确的悬停反馈

### 需求 3：排查并修复其他潜在问题

**用户故事：** 作为开发者，我希望 Diff 预览功能稳定可靠，没有明显的 bug。

#### 验收标准

1. THE MonacoDiffViewer SHALL 正确显示差异内容
2. THE 切换 side-by-side/inline 模式 SHALL 正常工作
3. THE diff 统计数字 SHALL 准确反映实际差异

## 边界情况

- **文件不存在**: 如果源文件已被删除，应提示用户
- **大文件**: Diff 视图应能处理大文件而不卡顿
