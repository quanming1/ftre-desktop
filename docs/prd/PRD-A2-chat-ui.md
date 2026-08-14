# PRD-A2-聊天界面

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A2 |
| 名称 | 聊天界面 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-12 |
| 关联文档 | docs/TODO.yaml 阶段 A2；AGENTS.md |

## 1. 背景与目标

- **背景**：ftre 桌面客户端需要核心的聊天界面，用于展示 agent 的流式回复与用户的输入消息。
- **目标**：提供完整可用的聊天视图——消息列表、输入框、markdown 渲染、流式输出、代码高亮与工具调用卡片。
- **非目标**：不做消息持久化与多会话管理（B1 阶段）；不做复杂的富文本编辑器。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：ChatPanel 整体布局（头部 + 消息列表 + 输入区）
- [x] FR2：ChatMessageList 消息列表（滚动、折叠消息、空状态）
- [x] FR3：ChatInput 输入框（多行输入、发送按钮、快捷操作）
- [x] FR4：AssistantMessage agent 消息（markdown 渲染 + 流式追加 + 工具调用卡片）
- [x] FR5：UserMessage 用户消息展示
- [x] FR6：CodeBlock 代码块（语法高亮 + 复制按钮）
- [x] FR7：InlineToolCallCard 工具调用卡片（状态展示 + 可折叠）
- [x] FR8：streamingMarkdown 流式 markdown 解析渲染

### 2.2 非功能需求

- 性能：长对话滚动流畅，流式渲染不阻塞 UI
- 可访问性：键盘可操作（Enter 发送、Shift+Enter 换行）
- 兼容性：主流 markdown 语法 + 代码块语言

## 3. 技术方案

- 模块设计（`packages/renderer/src/features/chat/`）：
  - `ChatPanel.tsx`：会话主面板容器
  - `ChatMessageList.tsx`：虚拟化/折叠消息列表
  - `ChatInput.tsx`：输入区
  - `AssistantMessage.tsx`：agent 消息渲染（markdown + 流式 + 工具卡片）
  - `UserMessage.tsx`：用户消息
  - `CodeBlock.tsx`：代码块（highlight.js / shiki 高亮）
  - `InlineToolCallCard.tsx`：工具调用卡片
  - `streamingMarkdown.tsx`：流式 markdown 解析器
- 依赖选型：react-markdown（或自研 streamingMarkdown）、代码高亮库

## 4. 接口定义

- 组件 props：消息对象（role / content / toolCalls / streaming 标志）
- streamingMarkdown：输入 token 流，输出渲染后的 React 节点

## 5. 验收标准

- [x] AC1：用户消息与 agent 消息按内容正确渲染
- [x] AC2：流式输出追加过程无闪烁、无重复渲染
- [x] AC3：工具调用卡片可折叠展开，状态显示正确
- [x] AC4：代码块语法高亮正确，支持复制

## 6. 测试计划

- 手动验证：构造模拟消息流，检查各组件渲染与交互

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
| 2026-08-14 | 新增：AI 消息 markdown 内 ```mermaid 代码块渲染为图表（MermaidBlock，动态 import mermaid、strict 安全、失败回退源码）；含 mermaid 的消息显示「源码/渲染」切换按钮（流式结束后显示）；mermaid 图右上角放大按钮，Modal 全屏展示。文件预览（MarkdownPreview）同步支持。自动化测试：AssistantMessage mermaid 4 用例 + FileRenderer mermaid 1 用例 | 用户需求：聊天消息 md 中的 mermaid/html 等可渲染内容要能可视化 + 源码/渲染切换 + 放大查看 |
| 2026-08-14 | 优化放大弹窗：放弃 Modal（标准 header 过大），改为轻量全屏 overlay——细工具条（h-10：源码/渲染切换 + 缩放 +/-/重置 + 关闭），弹窗内可切换该图 mermaid 源码，图表 25%~400% 缩放（放大后可滚动）；标题小字显示 | 用户反馈：弹窗 header 太大、图标不能缩放、弹窗内需源码切换 |
| 2026-08-14 | 放大查看器重做为标准图片查看器交互：打开即 fit 适应视口（小图放大撑满、大图缩小放下，解决默认过小）；滚轮缩放（以光标为中心，非 passive 监听可 preventDefault）；拖拽平移（scale>1 时 grab 光标）；双击复位；工具条 缩放/百分比/适应窗口/源码/关闭 | 用户反馈：要图片放大组件的缩放效果、默认显示太小 |
