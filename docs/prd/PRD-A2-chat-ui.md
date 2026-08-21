# PRD-A2-聊天界面

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A2 |
| 名称 | 聊天界面 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-21 |
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
- [x] FR9：压缩横幅模型准确展示——处于 `compacting` 状态时，只显示后端 `context_compact_start.model` 提供的实际摘要模型；协议未提供时不显示模型，不能复用上一条 assistant 回复或当前选择的普通对话模型。
- [x] FR10：流式回复中的历史分页——用户点击“从服务器加载更早的消息”时，即使当前 assistant 回复仍在流式输出，已返回的历史页也必须 prepend 到消息列表；流式消息保持在列表末尾，不能静默丢弃该页。
- [x] FR11：同一 assistant reply 内相同 `tool_call_id` 的重复 `TOOL_CALL_START` 必须幂等处理，只保留一个工具调用 block；后续 `TOOL_CALL_DELTA`、`TOOL_CALL_END` 和工具结果仍按该 id 更新。

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
- [x] AC5：压缩横幅展示 `context_compact_start.model`；即使最近 assistant 回复和当前选择的普通模型都是其他值，也不得误显示为压缩模型。
- [x] AC6：会话存在仍在流式输出的 assistant 消息时，加载一页更早历史后，历史消息、当前消息与流式消息均保留且顺序正确；最早时间游标前移。
- [x] AC7：重复派发相同 `reply_id` + `tool_call_id` 的 `TOOL_CALL_START` 后，工具 blocks 数量仍为一个；后续 DELTA/END 更新同一 block，不产生 duplicate key。

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
| 2026-08-14 | 修复大图放大模糊：撤销 viewer 位图化（svg 转 img 后是位图，transform 放大即位图拉伸必然糊）并移除常驻 will-change:transform（锁死合成层光栅化分辨率同样导致放大糊）——恢复内联 SVG 矢量路径，Chrome 在 scale 变化后按新比例重新光栅化（矢量保真）；拖拽流畅性不受影响（平移不改变采样密度仍走合成层，React 零渲染机制不变），打开预热保留 | 用户反馈：大流程图放大会很糊 |
| 2026-08-14 | 新增本地文件链接（file://）：AI 消息/文件预览 markdown 中 [名](file:///E:/abs/path[#L42]) 渲染为文件 chip（FileIconView 图标+等宽字体，区别于网址链接），点击经 handleOpenFile/handleOpenFileAtLine 在编辑器面板打开（与 read/write 工具同款逻辑，支持行号跳转）；markdown-plugins 新增 urlTransform（默认白名单+file 协议，仅两处接入点放行，未拦截处保持清空的安全默认）；a 组件剔除 react-markdown v10 的 node prop 泄漏。配套后端 system_prompt 约定（ftre C5） | 用户需求：AI 输出本地文件特殊链接，点击在右侧面板打开 |
| 2026-08-14 | 文件链接 UI 轻量化：去背景/边框，文件名加粗 + 绿色虚线下边框（仅名字文本），hover 变绿并提示完整绝对路径，图标与行号不参与下划线 | 用户设计反馈 |
| 2026-08-14 | 文件链接 hover 提示从原生 title（Electron 约 1s 延迟且不明显）换为 @ftre/ui Tooltip（radix，delayDuration=0 即时显示，深色浮层，side=bottom），与消息操作栏同组件 | 用户反馈：没看到 tooltip |
| 2026-08-14 | 文件链接展示名自带行号（#L88-L102 / main.py:42 形式）时不再追加重复的 :line 后缀；行号跳转不受影响（仍取 href 的 #L） | 用户反馈：实际渲染中行号显示两遍 |
| 2026-08-17 | 修复 ChatInput 发送按钮状态陈旧：Slate 非受控，打普通文本时唯一 setState（skillSearch）为 null 被 React 跳过 → hasDraft 停留旧值、按钮保持禁用；改为 onChange 显式同步 hasText state，hasDraft 改读 state。新增回归测试（mock Slate 边界捕获 onChange 驱动输入） | 修复：输入文字后发送按钮不可点 |
| 2026-08-20 | 新增 FR9 / AC5：压缩横幅的模型标签改为只读取 `context_compact_start.model`，旧服务端未提供该字段时留空；增加“最近普通回复为 GLM、压缩为 DeepSeek”回归测试 | 修复：横幅此前复用上一条 assistant 回复的模型，把普通对话模型误标为压缩模型 |
| 2026-08-20 | 新增 FR10 / AC6：移除流式回复期间对历史页 prepend 的静默拦截；保留流式尾消息并按 id 去重。新增投影层回归测试 | 生产会话 `ws_sess_72611f0d2344` 验证服务端压缩锚点与分页均正常，但当前回复仍流式时，已请求成功的更早消息被客户端直接丢弃，点击按钮无视觉反馈 |
| 2026-08-21 | 调整输入框底部 Agent/LLM 控件：Agent 保留为独立切换入口；LLM 改为紧凑按钮及“模型 / 推理强度”双行弹层，沿用现有模型与推理强度保存逻辑 | 用户视觉调整需求 |
| 2026-08-21 | 模型与推理强度子菜单改为悬停展开，并将子菜单定位到主 LLM 面板右侧，悬停进入子菜单后保持可操作 | 用户补充的交互调整需求 |
| 2026-08-21 | 模型与推理强度 hover 子菜单改用 React Portal 挂载到 `document.body`，使用 `position: fixed` 跟随触发项定位，避免撑大输入框容器 | 修复 hover 浮层参与输入区布局的问题 |
| 2026-08-21 | 为模型/推理强度 Portal 增加真实尺寸边界计算：左右翻转、上下翻转或夹紧，并按视口高度限制浮层最大高度 | 修复小窗口或靠近视口边缘时浮层被裁切的问题 |
| 2026-08-21 | 聊天输入框的模型弹窗默认仅展示 Pin 模型，增加“更多模型”入口展开完整模型列表；输入搜索时自动使用全量模型范围 | 用户模型选择效率优化需求 |
| 2026-08-21 | 模型弹窗的“管理模型”改为搜索框右侧的小型设置图标按钮，移除底部整行管理入口 | 用户界面紧凑化调整需求 |
| 2026-08-21 | 修正模型弹窗 Active 状态：键盘 focus 优先于选中态，打开时不默认 focus 第一项；全量列表排除已展示的 Pin 模型 | 修复选中态与键盘导航态同时高亮、模型重复展示的问题 |
| 2026-08-21 | 修正键盘导航与当前选中态的互斥规则：存在 focus 时隐藏其他选中行的 Active 背景，仅保留选中 ✓ | 用户反馈上一版仍出现双 Active |
| 2026-08-21 | Agent 合并进 LLM 弹窗后，输入框底部 LLM 触发按钮改为内容自适应宽度，模型名称设置最大宽度并截断 | 修复 flex-1 导致按钮占满剩余空间的问题 |
| 2026-08-21 | LLM 弹窗打开时触发按钮宽度与弹窗统一为 248px 并左右对齐；hover 子浮窗取消进出动画；优化触发按钮字体与颜色层级 | 用户视觉调整需求 |
| 2026-08-21 | 收紧 Agent/模型/推理强度 hover 浮窗关闭延迟至 80ms，并通过共享 hover 事件保证三者互斥，快速移动时只保留当前浮窗 | 修复快速滑动时多个浮窗同时残留、关闭反馈偏慢的问题 |
| 2026-08-21 | LLM 底部触发按钮内容改为水平居中；增加按钮按压反馈、箭头旋转和按钮宽度布局过渡；优化模型/推理强度字体层级与间距 | 用户视觉调整需求 |
| 2026-08-21 | 上下文用量改为紧凑圆环进度指示器，移到 LLM 按钮左侧并移除圆心数字；tooltip 恢复默认圆角与 hover 触发 | 用户视觉调整需求；修复圆环布局过宽及 tooltip ref 未透传导致悬停提示消失 |
| 2026-08-21 | Inspector 侧栏顶部 tabs 改为工具按钮 + 分隔线 + 圆角胶囊 tab；Session 面板去掉右侧圆角，Inspector 侧栏去掉左侧圆角 | 用户视觉调整需求：让相邻面板边界更连续和谐 |
| 2026-08-21 | 侧边栏与 Session 面板背景统一为纯白 `#ffffff`，同步覆盖展开态、折叠态悬浮列表和 Workbench 外层面板 | 用户视觉调整需求 |
| 2026-08-21 | 将 Inspector 顶部固定的 `state.json`、`Traces`、`WS Logs` 合并为一个下拉按钮，菜单内切换固定面板；动态文件/Diff tabs 保持独立 | 用户交互简化需求 |
| 2026-08-21 | 收紧 state.json 内容区 Header：移除重复的“会话状态”大标题和底部边框，保留 session id、打开文件、复制、刷新与更新提示 | 用户反馈内容 Header 未同步 tabs 导航的轻量样式 |
| 2026-08-21 | 修正 Inspector 文件树侧栏背景：将 FileTreeSidebar、文件树容器、tabs header 及溢出遮罩统一为 `#ffffff` | 修复侧边栏仍显示浅灰背景的问题 |
| 2026-08-21 | 将会话右键菜单渲染移到折叠/展开布局分支之外，确保折叠后 hover 展开的会话列表也能正常显示右键菜单 | 修复折叠会话列表右键菜单未显示的问题 |
| 2026-08-21 | 撤回 SessionPanel 与 Workbench Session 外层的白色背景改动，恢复左侧 SessionList 原有 `#f6f7f9`；仅保留 Inspector 文件树侧栏的白色背景 | 修正误将 SessionList 一并改白的问题 |
| 2026-08-21 | Inspector 固定面板下拉弹窗移除边框，圆角调整为 `rounded-xl`，保留轻量阴影；不修改全局 DropdownMenu 样式 | 用户弹窗视觉调整需求 |
| 2026-08-21 | 移除 LLM 按钮外层 Framer layout 和按压缩放动画，避免展开时按钮宽度插值连带文字变形；保留弹窗淡入与箭头旋转 | 修复用户反馈的按钮展开动画异常 |
| 2026-08-21 | TokenRing 圆环尺寸从 20px 缩至 16px，环线加粗至 2.2px，保持无中心数字 | 用户视觉调整需求 |
| 2026-08-21 | Inspector 外层移除右侧圆角，文件树与 Session 内容之间的拖拽分隔宽度从 6px 缩至 3px，使两个面板视觉贴合 | 用户反馈 Session 面板右侧圆角和侧栏间隙仍明显 |
| 2026-08-21 | 文件预览 Header 新增面包屑样式：去掉圆角卡片边框、Header 贴边展示路径层级；仅 FileRenderer 使用，Diff 预览保留原样，右侧功能按钮逻辑不变 | 用户视觉参考图调整需求 |
| 2026-08-21 | Inspector 文件 tab 关闭按钮改为右侧绝对定位，默认隐藏、tab hover 时显示；右侧增加白色渐变遮罩，避免关闭按钮覆盖文件名 | 用户关闭按钮布局与视觉调整需求 |
| 2026-08-21 | DiffRenderer 同步使用 breadcrumb 文件预览 Header，保留增删统计与 diff 工具栏；路径支持悬停查看绝对路径和点击复制 | 用户反馈 diff 展示下的文件预览 Header 未同步优化 |
| 2026-08-21 | 移除 Inspector 文件树容器在收起状态下残留的右边框，避免文件预览左侧出现 1px 竖线 | 用户反馈文件预览仍有一条边框未消除 |
| 2026-08-21 | 移除会话折叠后 hover 浮层残留的 `rounded-r-xl`，消除 Session 面板右上角圆弧；保留浮层阴影和边界线 | 用户反馈 Session 面板仍显示右侧圆角 |
| 2026-08-21 | 收紧文件路径 tooltip：仅展示绝对路径，移除浅色主题下不可见但占高度的复制提示行；点击复制逻辑保持不变 | 用户反馈 tooltip 下方出现大块空白 |
| 2026-08-21 | 模型切换浮窗主体和搜索框由浅灰 `bg-elevated/bg-base` 调整为白色 `bg-surface`，同步使用浅色边框和统一阴影 | 用户模型切换浮窗颜色优化需求 |
| 2026-08-21 | SessionList 与 TitleBar 改为主题化半透明 surface + backdrop blur/saturate，底层布局背景切换为 base；保留会话选中态、hover 态和交互，不再使用固定 `#f6f7f9` | 用户希望参考 Codex 的 SessionList/header 毛玻璃效果 |
| 2026-08-21 | 文件树分隔线改为仅在文件树展开时显示的条件边框；收起时不占位，展开时恢复文件树与右侧内容区域的视觉隔离 | 用户反馈移除残留边框后文件树与内容区失去隔离 |
| 2026-08-21 | TokenRing 普通状态颜色由 `text-t-muted` 调浅为 `text-t-dim`，并向下偏移 1px 对齐输入栏底部控件 | 用户反馈 token ring 颜色过深且需要下移一个 offset |
| 2026-08-21 | 修正 SessionList/Header 毛玻璃可见性：移除中间 `bg-base` 不透明遮挡，增加主题化蓝/暖色底层渐变，surface 透明度由 60% 降至 50%，保留 backdrop blur/saturate | 用户反馈毛玻璃效果被前置固定颜色遮挡、视觉上未生效 |
| 2026-08-21 | 优化 SessionList 与主内容接缝：移除 Header 硬底线，取消 SessionList 外层左侧圆角，并将两者之间的可调分隔区从 6px 收紧为 2px | 用户反馈毛玻璃区域与主内容接缝明显 |
| 2026-08-21 | 将 Workbench 全局底层背景调整为更明显的蓝/暖色多层渐变，SessionList/Header/折叠浮层透明度降至约 42%，让毛玻璃效果不再只在接缝处可见 | 用户要求整体背景一起调整，增强 Codex 风格毛玻璃效果 |
| 2026-08-21 | Session 与 Chat 分隔手柄恢复 6px 可拖拽热区，通过 `-mx-2px` 将视觉占位压缩到约 2px，修复接缝收紧后无法拖动的问题 | 用户反馈 SessionList 与 Session 页面之间的手柄拖不到 |
| 2026-08-21 | 定位并移除 ChatPanel 外层残留的 `rounded-xl`，改为无圆角；该层才是截图中左侧会话内容区域右侧圆弧的实际来源，SessionPanel 不再重复调整 | 用户反馈 Session 面板仍有圆角 |
| 2026-08-21 | 将 Session/Chat 分隔手柄的负 margin 从 2px 调整为 3px，保持 6px 拖拽热区同时消除可见过渡缝隙，让两侧内容直接衔接 | 用户反馈接缝处仍有明显断层 |
| 2026-08-21 | 恢复 Session 外层左侧 `rounded-l-xl`，仅保持右侧与 Chat 的无缝接缝处理 | 用户明确要求 Session 面板左侧保留圆角 |
| 2026-08-21 | 为 Session 外层左侧增加低对比度内边界（左/上/下边框），让半透明背景下的左侧圆角轮廓可见，右侧仍不增加边框 | 用户反馈毛玻璃下左侧圆角视觉上消失 |
| 2026-08-21 | 恢复中间 Chat/Session 页面外层 `rounded-xl`；左侧 SessionList 继续保持右侧无圆角，区分两个面板的圆角职责 | 用户反馈中间 Session 页面缺少圆角 |
| 2026-08-21 | 移除 Inspector 文件树按钮上的下拉箭头，仅保留文件夹图标 | 用户视觉微调需求 |
| 2026-08-21 | 左上会话导航仅调整现有功能的 UI：新会话、定时任务、技能改为扁平左对齐行，去掉胶囊按钮感并收紧间距；保留搜索与收起功能，不新增参考图中不存在的功能 | 用户视觉参考图调整需求 |
| 2026-08-21 | 移除 Inspector tabs 导航和文件预览面包屑 Header 的重复底部边框，保留原有内容和交互 | 用户反馈文件预览区域边框过多 |
| 2026-08-21 | Inspector 固定面板下拉菜单改用普通菜单项，移除 `DropdownMenuRadioItem` 默认绿色圆点；当前项仅通过背景和文字颜色区分 active | 用户反馈不使用小绿点作为 active 标志 |
| 2026-08-21 | 文件预览 breadcrumb 路径改为轻量可点击区域：悬停显示完整绝对路径，点击复制绝对路径；移除原生 title 提示并优化分隔符、hover 背景和复制反馈 | 用户路径 Header 交互与视觉优化需求 |
| 2026-08-21 | 新增 FR11 / AC7：相同 `tool_call_id` 的重复 TOOL_CALL_START 在客户端幂等处理，不产生重复工具 block 或 React key；Electron CSP 相关验收纳入 PRD-A1-electron-scaffold.md | 修复开发客户端中的 duplicate key 与 Insecure Content-Security-Policy 控制台警告 |
| 2026-08-21 | 已验收（AC1-AC7 重跑）：chat.test.ts 14 例全过（新增重复 START 幂等 + Reply 快照去重回归）；全量 vitest 失败集合与改动前基线完全一致（无回归）；electron/renderer 构建与类型通过；vite preview + 浏览器验证 CSP 不阻断页面且无违规。仅真实 `pnpm dev` 下工具调用流的控制台观察需在用户环境确认 | 对照 AC 验收留痕 |
