# 将 Cursor 命令转换为 Skill 格式

> **目标：** 将 `.cursor/commands/speckit.*.md` 转换为正确的 Skill 格式，放在 `skill_demo/` 目录下，让 AI Agent 可以使用 spec-kit 工作流

## 背景

- `.cursor/commands/` 下有 8 个 speckit 命令文件，是 Cursor 的命令格式
- `skill_demo/` 下现有的文件格式错误，需要删除并重写
- Skill 是给 AI Agent 用的模块化包，有特定的格式要求

## Skill 格式规范

### 目录结构

```
skill-name/
├── SKILL.md          # 必需：YAML frontmatter + 指令
├── scripts/          # 可选：可执行代码
├── references/       # 可选：按需加载的参考文档
└── assets/           # 可选：输出用的资源
```

### SKILL.md 格式

```markdown
---
name: skill-name
description: 清晰描述这个 skill 做什么，以及何时应该被触发。这是 AI 判断是否使用此 skill 的唯一依据。
---

# Skill 标题

简要说明。

## 执行流程

### 1. 步骤一
...

### 2. 步骤二
...

## 输出

描述产出什么文件。

## 示例

简洁的输入输出示例。
```

### 核心原则

1. **简洁**：只包含 AI 需要的信息，不要冗余解释
2. **渐进加载**：SKILL.md 控制在 500 行以内，详细内容放 references/
3. **不要包含**：README、安装指南、changelog 等辅助文档
4. **无脚本依赖**：不依赖 bash 脚本，AI 直接执行逻辑

## 需要转换的命令

| Cursor 命令 | 目标 Skill 目录 |
|------------|----------------|
| `speckit.specify.md` | `skill_demo/specify/` |
| `speckit.plan.md` | `skill_demo/plan/` |
| `speckit.tasks.md` | `skill_demo/tasks/` |
| `speckit.implement.md` | `skill_demo/implement/` |
| `speckit.analyze.md` | `skill_demo/analyze/` |
| `speckit.checklist.md` | `skill_demo/checklist/` |
| `speckit.clarify.md` | `skill_demo/clarify/` |
| `speckit.constitution.md` | `skill_demo/constitution/` |

## 转换规则

1. **移除**：
   - YAML frontmatter 中的 Cursor 特定字段
   - `$ARGUMENTS` 变量引用
   - `.specify/scripts/bash/*.sh` 脚本调用
   - 绝对路径要求

2. **保留**：
   - 核心工作流逻辑
   - 输出文件结构
   - 关键原则和规则
   - 示例

3. **修改**：
   - 路径从 `.specify/` 改为 `.ftre/`
   - 添加正确的 `name` 和 `description` frontmatter

## 额外清理

1. 删除 `skill_demo/` 下的错误文件：
   - `README.md`
   - `specify.md`（根目录的，不是子目录）
   - `plan.md`
   - `tasks.md`
   - `implement.md`
   - `analyze.md`
   - `checklist.md`
   - `templates/`

2. 删除或归档：
   - `命令快速参考.md`
   - `.specify/` 目录（脚本不再需要）
