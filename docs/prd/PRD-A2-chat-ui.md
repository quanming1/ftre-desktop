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
| 2026-08-14 | mermaid 查看器 UI/交互整体对齐 @ftre/ui ImageViewer（聊天图片放大组件）：高斯模糊遮罩 + 右上角圆形关闭 + 底部居中圆角操作栏（24px 大图标：放大/百分比/缩小/重置/源码）+ 滚轮 0.2~10x + 拖拽 + transform 动画 + Esc/点空白关闭 + portal 到 body；消息内 svg 去 width/height 撑满容器宽（修复默认显示过小） | 用户反馈：要图片放大组件的同款 UI 与缩放，默认图表太小 |
| 2026-08-14 | 性能优化（FR4 markdown 渲染）：mermaid.initialize 模块级单次（多图并发无重复初始化/竞态）；stripSvgSize 结果 useMemo（拖拽缩放每帧重渲染不重跑全文正则，svg 可达几百 KB）；MarkdownPreview components 提模块级（content 变化不再重挂 code 子树导致图表重渲）；消息内图表 content-visibility:auto（视口外跳过渲染，列表滚动流畅），viewer 打开时内联副本降为 hidden；error 提示截断 500 字符 | 用户要求：做好性能优化 |
| 2026-08-14 | 修复放大查看图表不可见：svg 剥掉固有宽高后在 flex 容器中无内在尺寸（不同于 img）而塌缩为 0——改为解析 viewBox 固有尺寸，图表容器显式给定适配像素（撑满 92vw × 80vh，等价 img object-contain）；测试 mock 补 viewBox 并断言容器像素尺寸防回归 | 用户反馈：点放大查看后看不到图表 |
| 2026-08-14 | 修复消息内 mermaid 图表高度爆炸：竖向图（viewBox 高>>宽）撑满消息宽后高度等比放大至数千像素——改为满宽 wrapper + ResizeObserver 测容器宽，按 容器宽 × min(60vh,640) 双向 contain 显式给像素（横图按宽、竖图按高）；contain-intrinsic-size 同步用实际高度 | 用户反馈：markdown 中渲染的图高度非常高 |
| 2026-08-14 | 拖拽/缩放性能重构：高频交互路径零 React 渲染——scale/position/isDragging 改 ref 真值 + syncDom 直改 DOM（transform/百分比/cursor，rAF 合并一帧多次调用），拖动 mousemove 不再触发整个 lightbox（含几百 KB svg 容器）reconcile；viewer 容器 will-change:transform 提升合成层；React state 仅保留 zoomed/showCode 低频结构切换 | 用户反馈：拖动的时候性能不好 |
| 2026-08-14 | 消除首次拖动卡顿：viewer 内 svg 转 blob URL <img> 位图渲染（img 纹理加载即上传 GPU，与 ImageViewer 同硬件路径；svg 含 foreignObject 或环境不支持时自动回退内联 SVG）；打开 lightbox 后两帧预热（0.1% 缩放往返，强制提前光栅化，归位前校验未被打扰） | 用户反馈：首次拖动的时候会卡一下 |
