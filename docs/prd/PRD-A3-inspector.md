# PRD-A3-Inspector 面板

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A3 |
| 名称 | Inspector 面板 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-12 |
| 关联文档 | docs/TODO.yaml 阶段 A3；AGENTS.md |

## 1. 背景与目标

- **背景**：agent 在工作区执行文件操作时，用户需要直观查看文件内容、diff 变更与图片预览。
- **目标**：提供可停靠的 Inspector 扩展面板，以 tab 形式展示文件内容 / diff / 图片，并支持文件树侧栏浏览。
- **非目标**：不做文件编辑能力（只读查看）；不做跨会话的 tab 持久化。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：InspectorPanel tab 管理（打开 / 切换 / 关闭 / 拖拽排序 / 去重）
- [x] FR2：DiffRenderer diff 渲染（side-by-side 与 unified 两种模式）
- [x] FR3：FileRenderer 文件内容渲染（Monaco 只读编辑器）
- [x] FR4：ImageRenderer 图片预览（base64 数据渲染）
- [x] FR5：tabRegistry tab 注册表（按 toolCallId 去重，同一操作只开一个 tab）
- [x] FR6：FileTreeSidebar 文件树侧栏（目录懒加载 + git 状态标识）
- [x] FR7：FileRenderer md / html 渲染预览（markdown 走共享渲染管线，html 走 sandbox iframe；默认渲染视图，可切换源码）

### 2.2 非功能需求

- 性能：大文件打开不卡顿（Monaco 虚拟渲染）
- 兼容性：常见文本与图片格式；diff 支持行内高亮

## 3. 技术方案

- 模块设计（`packages/renderer/src/features/inspector/`）：
  - `InspectorPanel.tsx`：面板容器 + tab 管理
  - `renderers/DiffRenderer.tsx`：diff 视图（side-by-side / unified）
  - `renderers/FileRenderer.tsx`：Monaco 只读文件视图
  - `renderers/ImageRenderer.tsx`：base64 图片预览
  - `tabRegistry.ts`：tab 去重注册表
  - `FileTreeSidebar.tsx`：文件树侧栏
- 依赖选型：@monaco-editor/react、diff 解析库

## 4. 接口定义

- tab 注册：`tabRegistry.open({ toolCallId, kind, payload })` → 返回或复用已有 tab
- Inspector 与 chat 联动：read / edit / write 工具调用自动打开对应 tab

## 5. 验收标准

- [x] AC1：read 工具调用后打开 file tab 并正确渲染文件内容
- [x] AC2：edit / write 工具调用后打开 diff tab 展示变更
- [x] AC3：图片工具返回的 base64 内容可在 ImageRenderer 预览
- [x] AC4：tab 支持拖拽排序，同 toolCallId 不重复开 tab
- [x] AC5：md / html 文件默认打开渲染视图且可切回源码（keep-alive 切换）；html 以 sandbox iframe 隔离渲染；非 md / html 文件不受影响（自动化测试 3/3 通过）

## 6. 测试计划

- 手动验证：模拟 read / edit / write / 图片工具调用，检查 tab 行为与渲染

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
| 2026-08-14 | 新增 FR7 / AC5：FileRenderer 支持 md / html 渲染预览——markdown 复用共享渲染管线（markdown-plugins + rehype-highlight），html 走 sandbox iframe；默认打开即渲染视图，工具栏可切回源码（markdown keep-alive、iframe 切回即卸载）。原 AC1-AC4 不受影响，新增 AC5 自动化测试 3/3 通过 | 用户需求：文件预览 md / html 时直接看渲染结果 |
