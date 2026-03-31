# UI / UX 交互优化 TODO

## 当前问题总结

~~所有组件都是 inline style 堆砌，没有统一的交互语言。~~
已迁移至 Tailwind CSS v4 + 全局工具类。

---

## 1. 样式架构重构

- [x] 集成 Tailwind CSS v4（@tailwindcss/vite）
- [x] 全部组件从 inline style 迁移到 Tailwind 类名
- [x] 提取通用交互类到 global.css（.interactive, .btn-ghost, .btn-accent, .btn-success, .btn-error, .section-header, .kbd, .spinner）
- [x] 统一 transition：所有按钮自带 transition
- [x] 去掉所有 onMouseEnter/onMouseLeave 的 style 操作，改用 CSS :hover / Tailwind hover:

---

## 2. TitleBar

- [x] 标题区域加品牌标识（accent 色方块）
- [x] 标题栏中间区域显示当前文件名
- [x] 窗口按钮 SVG 放大到 12x12，线条加粗到 1.5
- [x] 双击标题栏区域触发最大化/还原
- [ ] 标题栏背景色微调（需要视觉确认）

---

## 3. StatusBar

- [x] 左侧显示后端连接状态（绿色圆点 + 文字）
- [x] 中间显示当前文件的语言类型
- [x] Terminal 按钮加终端符号 >_
- [ ] 右侧显示光标位置（Ln x, Col y）— 需要 Monaco onDidChangeCursorPosition
- [x] 所有 StatusBar 项统一高度和 padding

---

## 4. Sidebar / 文件树

- [x] 文件树项高度调整为 28px（h-7）
- [x] 展开箭头改用 SVG chevron
- [ ] 文件/文件夹加简单 SVG 图标（暂用文字）
- [x] 空状态重新设计：居中布局 + 按钮
- [x] 当前打开文件高亮改为左侧 2px accent 色竖线
- [x] section-header 统一样式

---

## 5. TabBar

- [x] 关闭按钮改用 SVG x 图标
- [x] 活跃 Tab 底部加 2px accent 色线条
- [x] 非活跃 Tab 之间加 1px 竖线分隔
- [x] 修改状态圆点放大（w-2 h-2）
- [ ] Tab 溢出时显示左右滚动箭头
- [x] 关闭按钮默认隐藏，hover Tab 时才显示（group/group-hover）

---

## 6. Chat 面板

### 6.1 面板头部
- [x] "Chat" 标题和 session ID 之间加分隔线
- [x] "New" 按钮用 btn-ghost 统一样式

### 6.2 消息列表
- [x] 用户消息右对齐（self-end），AI 消息左对齐
- [x] 用户消息背景色改为 accent-muted

### 6.3 ToolCallCard
- [x] running 状态加 CSS spinner 旋转动画
- [x] done 状态改为 checkmark SVG
- [x] 展开后的标签用 uppercase + tracking-wide
- [x] pre 块行高调整为 leading-relaxed

### 6.4 ChatInput
- [x] 输入框获得焦点时加 accent 色 ring（focus-within:ring-1）
- [x] Send 按钮改为箭头向上 SVG
- [x] Stop 按钮改为方形停止符号 SVG
- [x] placeholder 颜色用 text-muted

### 6.5 ModelSelector
- [x] 下拉面板出现加 fadeIn 过渡动画
- [x] 当前选中模型用 accent 色
- [ ] 搜索框加放大镜 SVG 图标（暂用 placeholder）

---

## 7. DiffBar

- [x] 文案精简为 "Modified by {toolName}"
- [x] Accept 按钮用 btn-success，Reject 用 btn-error
- [x] 两个按钮之间加竖线分隔

---

## 8. SplitPane 拖拽条

- [x] 默认宽度改为 1px，hover 扩展
- [x] 拖拽过程中变为 accent 色（hover:bg-accent）
- [ ] hover 时中间显示拖拽手柄（三条短横线）— 低优先级

---

## 9. 欢迎页

- [x] 居中显示品牌名，较大字号 + text-muted
- [x] 下方显示快捷键提示列表
- [x] 快捷键用 kbd 样式
- [ ] 最近打开的文件列表（需要持久化历史记录）

---

## 10. 全局交互一致性

- [x] 所有可点击元素统一 cursor: pointer（Tailwind cursor-pointer / reset button）
- [x] 所有按钮统一 :focus-visible 样式
- [x] 统一 transition 时长
- [x] 滚动条样式在所有面板中保持一致（reset.css）
- [x] 所有面板标题统一样式和高度（.section-header）
- [x] 所有 section header 统一为 11px uppercase letter-spacing

---

## 执行状态

1. ~~样式架构重构~~ -- DONE (Tailwind CSS v4)
2. ~~全局交互一致性~~ -- DONE
3. ~~TitleBar + StatusBar~~ -- DONE
4. ~~TabBar + 文件树~~ -- DONE
5. ~~Chat 面板~~ -- DONE
6. ~~DiffBar + SplitPane + 欢迎页~~ -- DONE

剩余小项（低优先级）：
- StatusBar 光标位置显示
- Tab 溢出滚动箭头
- SplitPane 拖拽手柄
- 最近打开文件列表
- 文件/文件夹图标
