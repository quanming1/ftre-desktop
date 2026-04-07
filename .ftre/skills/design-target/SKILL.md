---
name: design-target
description: |
  ftre 项目设计规范。定义 ftre 的视觉风格、色彩系统、字体、组件样式等设计标准。
  触发场景：
  - 开发新 UI 组件时需要遵循设计规范
  - 调整界面色彩、间距、字体时参考
  - 审查 UI 代码是否符合设计标准
  - 需要了解 ftre 的品牌色和视觉风格
---

# ftre 设计规范

## 1. 视觉主题与氛围

ftre 采用深色主题设计，灵感来自 VS Code Dark+ 和 IDEA Darcula。整体风格追求**专业、沉稳、高效**，以深灰色为主基调，搭配标志性的霓虹绿（`#00ff88`）作为点缀色，营造出现代代码编辑器的科技感。

与纯黑背景不同，ftre 选择深灰（`#1e1e1e`）作为主背景色，这样既能减少长时间使用的视觉疲劳，又能保持足够的对比度让代码清晰可读。霓虹绿的点缀打破深色调的沉闷，为界面注入活力，同时也成为 ftre 的视觉标识。

**核心特征：**
- 深灰背景（`#1e1e1e`）而非纯黑，提升可读性
- 霓虹绿（`#00ff88`）作为品牌色和强调色
- 多层次灰色系统，区分不同界面层级
- 极简边框，使用低透明度分隔
- 4px 基础间距系统
- 圆角克制（4px/6px），保持专业感

## 2. 色彩系统

### 背景层级（从深到浅）

| 名称 | 色值 | 用途 |
|------|------|------|
| Base | `#1e1e1e` | 主背景、编辑器区域 |
| Surface | `#252526` | 侧边栏、面板背景 |
| Elevated | `#2d2d2d` | 悬浮层、弹窗、下拉菜单 |
| Panel | `#333333` | 输入框背景、卡片 |
| Border | `#3c3c3c` | 主要边框 |
| Border Subtle | `#454545` | 次要边框、分隔线 |

### 品牌色（霓虹绿系列）

| 名称 | 色值 | 用途 |
|------|------|------|
| Neon | `#00ff88` | 主强调色、激活状态、成功提示 |
| Neon Hover | `#00cc6e` | 悬停状态 |
| Neon Dim | `rgba(0, 255, 136, 0.12)` | 低调强调、选中背景 |
| Neon Ghost | `rgba(0, 255, 136, 0.06)` | 极淡背景、hover 态 |

### 文字层级

| 名称 | 色值 | 用途 |
|------|------|------|
| Primary | `#e8e8e8` | 主要文字、标题 |
| Secondary | `#cccccc` | 次要文字、正文 |
| Muted | `#aab0b8` | 辅助说明、标签 |
| Dim | `#969ca6` | 弱化文字 |
| Ghost | `#888e98` | 占位符、禁用态 |
| Faint | `#7a8088` | 最弱文字、时间戳 |

### 语义色

| 名称 | 色值 | 用途 |
|------|------|------|
| Success | `#00ff88` | 成功、完成（复用品牌色） |
| Warning | `#d29922` | 警告、注意 |
| Error | `#f85149` | 错误、危险 |
| Info | `#58a6ff` | 信息、链接 |

### AI 操作色（用于展示 AI 工作流）

| 名称 | 色值 | 用途 |
|------|------|------|
| Thinking | `#a78bfa` | 思考中状态（淡紫） |
| Search | `#60a5fa` | 搜索/grep 操作（蓝色） |
| Read | `#34d399` | 读取文件（绿色） |
| Edit | `#fbbf24` | 编辑操作（琥珀） |
| Execute | `#f472b6` | 执行命令（粉色） |

## 3. 字体系统

### 字体家族

| 用途 | 字体栈 |
|------|--------|
| 代码/等宽 | `"JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", monospace` |
| 界面/无衬线 | `"Inter", -apple-system, "Segoe UI", sans-serif` |

### 字号层级

| 角色 | 字号 | 用途 |
|------|------|------|
| XS | 11px | 状态栏、微标签、时间戳 |
| SM | 12px | 侧边栏项、Tab 标签、辅助文字 |
| MD | 13px | 正文、菜单项、对话内容 |
| LG | 14px | 标题、强调文字 |

### 排版原则

- **代码优先**：编辑器区域使用等宽字体，确保代码对齐
- **行高充裕**：代码行高 1.5，界面文字行高 1.4
- **字重克制**：主要使用 400（常规）和 500（中等），少用粗体
- **中文友好**：Inter 配合系统中文字体，确保中英文混排协调

## 4. 间距与圆角

### 间距系统（基于 4px）

| 名称 | 值 | 用途 |
|------|-----|------|
| XS | 4px | 紧凑间距、图标与文字 |
| SM | 8px | 元素内间距、列表项间隙 |
| MD | 12px | 卡片内边距、区块间距 |
| LG | 16px | 面板间距、大区块分隔 |
| XL | 24px | 页面边距、主要区块分隔 |

### 圆角

| 名称 | 值 | 用途 |
|------|-----|------|
| SM | 4px | 按钮、输入框、小卡片 |
| MD | 6px | 弹窗、面板、大卡片 |

## 5. 组件样式

### 按钮

**主要按钮（Primary）**
- 背景：`#00ff88`（霓虹绿）
- 文字：`#1e1e1e`（深色）
- 悬停：`#00cc6e`
- 内边距：8px 16px
- 圆角：4px

**次要按钮（Secondary）**
- 背景：`#333333`
- 文字：`#e8e8e8`
- 边框：`1px solid #3c3c3c`
- 悬停背景：`#3c3c3c`
- 内边距：8px 16px
- 圆角：4px

**幽灵按钮（Ghost）**
- 背景：透明
- 文字：`#cccccc`
- 悬停背景：`rgba(255, 255, 255, 0.06)`
- 内边距：6px 12px
- 圆角：4px

**图标按钮**
- 尺寸：28px × 28px 或 24px × 24px
- 背景：透明
- 悬停背景：`rgba(255, 255, 255, 0.06)`
- 圆角：4px

### 输入框

- 背景：`#333333`
- 文字：`#e8e8e8`
- 占位符：`#888e98`
- 边框：`1px solid #3c3c3c`
- 聚焦边框：`1px solid #00ff88`
- 内边距：8px 12px
- 圆角：4px

### 卡片与面板

- 背景：`#252526` 或 `#2d2d2d`
- 边框：`1px solid #3c3c3c`（可选）
- 圆角：6px
- 内边距：12px 或 16px

### 菜单与下拉

- 背景：`#2d2d2d`
- 边框：`1px solid #3c3c3c`
- 圆角：6px
- 阴影：`0 4px 12px rgba(0, 0, 0, 0.3)`
- 菜单项悬停：`rgba(255, 255, 255, 0.06)`
- 菜单项内边距：8px 12px

### 标签页（Tab）

- 背景（未选中）：透明
- 背景（选中）：`#1e1e1e`
- 文字（未选中）：`#969ca6`
- 文字（选中）：`#e8e8e8`
- 底部指示器（选中）：`2px solid #00ff88`（可选）

### 列表项

- 背景：透明
- 悬停背景：`rgba(255, 255, 255, 0.04)`
- 选中背景：`rgba(0, 255, 136, 0.06)`
- 选中文字：`#e8e8e8`
- 内边距：6px 12px

## 6. 特殊布局

### 标题栏

- 高度：40px
- 背景：`#1e1e1e`
- 拖拽区域：整个标题栏
- 窗口控制按钮：右侧

### 状态栏

- 高度：32px
- 背景：`#1e1e1e`
- 文字：`#969ca6`
- 图标间距：8px

### 侧边栏

- 宽度：可拖拽调整，默认 260px
- 背景：`#252526`
- 与主区域分隔：`1px solid #3c3c3c`

## 7. 动效原则

### 时长

| 类型 | 时长 | 用途 |
|------|------|------|
| 快速 | 100ms | 悬停反馈、按钮状态 |
| 标准 | 150ms | 展开/收起、切换 |
| 中等 | 200ms | 弹窗出现、面板滑动 |
| 缓慢 | 300ms | 页面过渡、复杂动画 |

### 缓动函数

- 默认：`ease-out`
- 弹性：`cubic-bezier(0.34, 1.56, 0.64, 1)`
- 强调：`cubic-bezier(0.16, 1, 0.3, 1)`

### 原则

- **克制**：动效服务于功能，不做无意义装饰
- **快速响应**：交互反馈要即时，不让用户等待
- **自然流畅**：避免生硬的线性动画

## 8. 图标

- 风格：线性图标，1.5px 描边
- 尺寸：16px（标准）、14px（紧凑）、20px（强调）
- 颜色：继承文字颜色，或使用 `currentColor`
- 库：推荐 Lucide Icons

## 9. 响应式与适配

### 最小窗口尺寸

- 宽度：800px
- 高度：600px

### 面板折叠

- 侧边栏可完全折叠
- 底部面板可折叠/展开
- 支持多面板分屏

## 10. 无障碍

- 文字对比度符合 WCAG AA 标准
- 可聚焦元素有清晰的焦点样式（`#00ff88` 边框）
- 支持键盘完整操作
- 图标配合文字或 tooltip 说明

---

## Agent 设计指南

在编写 UI 代码时，遵循以下原则：

### 色彩使用

```css
/* 使用 Tailwind 类名 */
.element {
  @apply bg-base text-t-primary border-border;
}

/* 或使用 CSS 变量 */
.element {
  background: var(--color-base);
  color: var(--color-t-primary);
  border: 1px solid var(--color-border);
}
```

### 常用 Tailwind 类名映射

| CSS 变量 | Tailwind 类名 |
|----------|---------------|
| `--color-base` | `bg-base` |
| `--color-surface` | `bg-surface` |
| `--color-elevated` | `bg-elevated` |
| `--color-neon` | `text-neon`, `bg-neon`, `border-neon` |
| `--color-t-primary` | `text-t-primary` |
| `--color-t-secondary` | `text-t-secondary` |
| `--color-t-muted` | `text-t-muted` |
| `--color-border` | `border-border` |

### 设计检查清单

- [ ] 背景色是否使用正确的层级？
- [ ] 文字对比度是否足够？
- [ ] 强调色是否只用于需要突出的地方？
- [ ] 间距是否遵循 4px 倍数？
- [ ] 圆角是否统一（4px/6px）？
- [ ] 悬停/聚焦状态是否有反馈？
- [ ] 动效是否克制且流畅？
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
