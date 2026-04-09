---
name: spacious-ui
description: |
  大方留白的 UI 设计技能。适用于 ftre 项目中需要设计设置页面、表单、列表等内容型界面的场景。
  触发场景：
  - 设计新的设置/配置页面
  - 创建表单界面
  - 设计列表/详情页面
  - 需要"大气"、"留白"、"简洁但不简陋"的 UI 风格
  核心理念：主角突出 + 大量留白 + 完整交互
---

# Spacious UI 设计技能

## 核心理念

**简洁不是简陋** — 视觉元素少，但交互完整；留白多，但信息层次清晰。

三大原则：
1. **主角突出** — 页面有明确的视觉焦点，标题大、输入框大、按钮醒目
2. **大量留白** — 元素之间有充足的呼吸空间，不拥挤
3. **完整交互** — hover、focus、disabled、loading 状态都要考虑

## 排版节奏

### 间距系统（基于 ftre 4px 基准，放大使用）

| 场景 | 间距 | Tailwind |
|------|------|----------|
| 页面顶部到标题 | 0（继承父容器） | - |
| 标题到副标题 | 8px | `mb-2` |
| 标题区到内容区 | 48-64px | `mb-12` / `mb-16` |
| 表单字段之间 | 32px | `space-y-8` |
| 字段 label 到输入框 | 12px | `mb-3` |
| 内容区到底部按钮 | 64px | `mt-16` |
| 列表项垂直内边距 | 16px | `py-4` |

### 字号层级

| 角色 | 字号 | 字重 | 用途 |
|------|------|------|------|
| 页面标题 | 24px | light (300) | 大标题，视觉焦点 |
| 英雄输入 | 18px | light (300) | 主要输入字段（如 Name） |
| 正文 | 14px | normal (400) | 描述、次要输入 |
| 辅助文字 | 13px | normal (400) | 说明、提示 |
| 标签 | 11-12px | normal (400) | 表单 label、状态文字 |
| 微文字 | 11px | normal (400) | ID、时间戳 |

## 组件模式

### 页面标题区

```tsx
<div className="mb-16">
  <h1 className="text-[24px] font-light text-t-primary mb-2">
    Page Title
  </h1>
  <p className="text-[13px] text-t-dim">
    Brief description of what this page does
  </p>
</div>
```

### 下划线输入框（英雄字段）

用于页面最重要的输入字段，大字号 + 下划线样式：

```tsx
<input
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder="Placeholder text"
  className="w-full text-[18px] font-light bg-transparent text-t-primary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors"
/>
```

### 下划线 Textarea

```tsx
<textarea
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder="What does this do?"
  rows={3}
  className="w-full text-[14px] bg-transparent text-t-secondary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors resize-none leading-relaxed"
/>
```

### 表单 Label

小号、大写、letter-spacing，放在字段上方：

```tsx
<label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
  Field Label
</label>
```

### 列表项（可点击）

整行可点击，hover 时标题变色，删除按钮只在 hover 时显示：

```tsx
<div
  onClick={() => handleClick(item)}
  className="group flex items-center justify-between py-4 border-b border-border/50 cursor-pointer hover:border-border transition-colors"
>
  <div className="min-w-0">
    <div className="text-[14px] text-t-primary group-hover:text-neon transition-colors">
      {item.name}
    </div>
    {item.description && (
      <div className="text-[12px] text-t-ghost mt-1 truncate max-w-[300px]">
        {item.description}
      </div>
    )}
  </div>
  <button
    onClick={(e) => {
      e.stopPropagation();
      handleDelete(item);
    }}
    className="p-2 opacity-0 group-hover:opacity-100 text-t-ghost hover:text-[#f85149] transition-all"
  >
    <Trash2 size={14} />
  </button>
</div>
```

### 主按钮（大号）

页面主操作，放在表单底部：

```tsx
<button
  onClick={handleSubmit}
  disabled={!isValid || saving}
  className="px-8 py-3 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
>
  {saving ? "Saving..." : "Save"}
</button>
```

### 次要操作链接

放在列表底部或作为辅助操作：

```tsx
<button
  onClick={handleAdd}
  className="inline-flex items-center gap-2 text-[13px] text-t-dim hover:text-neon transition-colors"
>
  <Plus size={14} />
  Add another item
</button>
```

### 返回链接

放在页面左上角：

```tsx
<button
  onClick={handleBack}
  className="inline-flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors mb-12"
>
  <ChevronLeft size={14} />
  Back
</button>
```

### 空状态

简洁的文字引导 + 醒目的 CTA：

```tsx
<div>
  <p className="text-[14px] text-t-muted leading-relaxed mb-8">
    No items yet. Create one to get started.
  </p>
  <button
    onClick={handleCreate}
    className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors"
  >
    <Plus size={16} strokeWidth={2} />
    Create Item
  </button>
</div>
```

## 交互细节

### Hover 状态

| 元素 | Hover 效果 |
|------|-----------|
| 列表项标题 | `text-t-primary` → `text-neon` |
| 列表项边框 | `border-border/50` → `border-border` |
| 删除按钮 | `opacity-0` → `opacity-100` |
| 文字链接 | `text-t-dim` → `text-neon` 或 `text-t-primary` |
| 输入框边框 | `border-border` → `border-neon`（focus） |

### Disabled 状态

```css
disabled:opacity-30 disabled:cursor-not-allowed
```

### Loading 状态

按钮文字变化，如 "Save" → "Saving..."，保持按钮尺寸不变。

### Focus 状态

输入框 focus 时边框变为 neon 绿：

```css
focus:outline-none focus:border-neon
```

## 配色（继承 ftre 规范）

### 文字层级

| 角色 | Tailwind | 用途 |
|------|----------|------|
| Primary | `text-t-primary` | 标题、主要文字 |
| Secondary | `text-t-secondary` | 正文 |
| Muted | `text-t-muted` | 辅助说明 |
| Dim | `text-t-dim` | 弱化文字、副标题 |
| Ghost | `text-t-ghost` | 占位符、最弱文字 |

### 边框

| 场景 | 样式 |
|------|------|
| 常规 | `border-border` |
| 弱化 | `border-border/50` |
| Focus | `border-neon` |

### 背景

此风格通常使用透明背景（`bg-transparent`），让下划线输入框融入页面。需要背景时使用 `bg-panel`。

## 页面结构模板

### 列表页

```tsx
<div className="h-full flex flex-col">
  {/* 标题区 */}
  <div className="mb-16">
    <h1 className="text-[24px] font-light text-t-primary mb-2">Items</h1>
    <p className="text-[13px] text-t-dim">Manage your items</p>
  </div>

  {/* 内容区 */}
  <div className="flex-1">
    {items.length === 0 ? (
      <EmptyState onAdd={handleAdd} />
    ) : (
      <div>
        <div className="space-y-1 mb-12">
          {items.map(item => <ListItem key={item.id} item={item} />)}
        </div>
        <AddMoreButton onClick={handleAdd} />
      </div>
    )}
  </div>
</div>
```

### 表单页

```tsx
<div className="h-full flex flex-col">
  {/* 返回链接 */}
  <BackButton onClick={handleBack} />

  {/* 内容区 */}
  <div className="flex-1">
    {/* 标题 */}
    <h1 className="text-[24px] font-light text-t-primary mb-2">Create Item</h1>
    <p className="text-[13px] text-t-dim mb-12">Fill in the details</p>

    {/* 表单 */}
    <div className="space-y-8">
      <HeroInput label="Name" ... />
      <TextareaField label="Description" ... />
      <SelectField label="Options" ... />
    </div>

    {/* 错误 */}
    {error && <ErrorMessage>{error}</ErrorMessage>}

    {/* 提交 */}
    <div className="mt-16">
      <PrimaryButton onClick={handleSubmit}>Save</PrimaryButton>
    </div>
  </div>
</div>
```

## 检查清单

设计完成后检查：

- [ ] 页面有明确的视觉焦点（大标题/英雄输入）
- [ ] 标题区与内容区间距足够（mb-12 或 mb-16）
- [ ] 表单字段间距统一（space-y-8）
- [ ] 所有可点击元素有 hover 反馈
- [ ] 输入框有 focus 状态（border-neon）
- [ ] 禁用状态清晰（opacity-30 + cursor-not-allowed）
- [ ] 删除等危险操作有颜色区分（#f85149）
- [ ] 空状态友好，有引导文字和 CTA
- [ ] 没有多余的边框/背景/图标装饰
