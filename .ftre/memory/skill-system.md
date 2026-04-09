# Skill 系统

> 扩展 Claude 能力的模块化知识包。每个 Skill 是一个自包含目录，包含 YAML frontmatter 的 `SKILL.md` 文件，通过 `name` 和 `description` 触发。

## ⚠️ 重要说明

**`skill_demo/` 目录下的文件格式是错误的** —— 它们是普通的 markdown 文档，不是真正的 Skill 格式。需要重构为正确的 Skill 目录结构。

## Skill 格式规范（正确）

### 目录结构

```
skill-name/
├── SKILL.md              # 必需。包含 YAML frontmatter + 指令
├── scripts/              # 可选。可执行代码
├── references/           # 可选。参考文档
└── assets/               # 可选。输出用的资源文件
```

### references/ 目录使用规范

用于存放 Skill 执行时需要的参考资源文件，如模板、示例等。

**典型场景**：
- `skill_demo/specify/references/spec-template.md` - specify 阶段复制到 spec.md 的模板
- `skill_demo/plan/references/plan-template.md` - plan 阶段复制到 plan.md 的模板
- `skill_demo/constitution/references/example.md` - 宪章文件的参考示例

**使用方式**：
- Skill 指令中指导 AI 用 `read` 工具读取 references/ 文件
- 然后用 `write` 工具将内容写入目标位置

### SKILL.md 格式

```markdown
---
name: skill-name
description: |
  描述该 skill 做什么。
  触发场景：
  - 场景1
  - 场景2
---

# Skill 标题

指令内容...
```

### 核心原则

1. **简洁** - 只包含 AI 需要的信息
2. **渐进式加载** - 按需激活
3. **无辅助文档** - 不应包含 README.md、安装指南、changelog 等

## Cursor 命令与 Skill 的区别

| 特性 | Skill 格式 | Cursor 命令格式 |
|------|-----------|-----------------|
| 目录结构 | `skill-name/SKILL.md` | `.cursor/commands/*.md` |
| 前置元数据 | ✅ YAML frontmatter (`name`, `description`) | ✅ YAML frontmatter (`description`) |
| 触发方式 | 自然语言识别 `description` | `/command` 前缀 |
| 脚本调用 | ❌ 不依赖外部脚本 | ✅ 依赖 `.sh` 脚本 |
| 变量替换 | ❌ 禁止 | ✅ 使用 `$ARGUMENTS` |

## 设计决策

### 多个独立 Skill vs 单一大 Skill

**方案 A：单一大 Skill**
```
spec-kit/
├── SKILL.md              # 总体工作流 + 触发条件
└── references/
    ├── specify.md
    ├── plan.md
    ├── tasks.md
    └── implement.md
```

**方案 B：多个独立 Skill**（✅ 采用）
```
skills/
├── specify/SKILL.md
├── plan/SKILL.md
├── tasks/SKILL.md
├── implement/SKILL.md
├── analyze/SKILL.md
└── checklist/SKILL.md
```

**决策理由**：系统支持用户**指定/选择特定 skill** 的功能，独立 Skill 允许用户按需调用特定阶段（如仅使用 `specify` 或仅使用 `plan`），更灵活。

### Bash 脚本的处理原则

Electron 桌面应用**没有终端执行 bash 脚本的能力**，因此 `.specify/scripts/bash/*.sh` 中的逻辑需要转换为 SKILL.md 中的指令。

**转换对照表**：

| 脚本功能 | 原 Bash 实现 | Skill 指令替代 |
|----------|-------------|---------------|
| 创建功能目录 | `mkdir -p` | 指导 AI 用 `write` 创建 |
| 复制模板文件 | `cp template.md` | `read` → `write` 复制 |
| 检查前置文件 | `if [ -f file ]` | `read` 工具检查 |
| 获取功能名称 | `git rev-parse` | 从用户输入提取 |

**原则**：Skill 通过 AI 的 read/write 工具执行操作，不依赖外部脚本。

## 批量创建 Skill 的工作流

当需要将多个源文件批量转换为独立 Skill 时，推荐使用以下工作流：

### 阶段 1：规划（文档三件套）

创建 `.ftre/specs/<task-name>/` 目录，包含：

| 文件 | 内容 |
|------|------|
| `requirements.md` | 目标、背景、格式规范 |
| `design.md` | 目录结构、架构决策 |
| `tasks.md` | 任务清单（含必读文件、转换规则、验证清单） |

### 阶段 2：并发执行

每个 Skill 创建作为独立 subagent 任务并发派发：

```
spawn_session(prompt="创建 skill_demo/specify/SKILL.md")
spawn_session(prompt="创建 skill_demo/plan/SKILL.md")
... // 并行派发
```

**每个 subagent 的 prompt 必须包含**：
1. 必读文件列表（格式规范、源文件、任务文档）
2. 明确的任务目标
3. 转换规则（YAML frontmatter、路径替换、禁止项等）

### 阶段 3：统一验证

所有子任务完成后，派发 Code Review 任务：

```
spawn_session(prompt="检查所有新创建的 Skill 文件，验证格式正确性、内容质量、旧文件清理")
```

### 要点

- **任务独立性**：每个 Skill 创建任务应独立，不互相依赖
- **前置阅读**：强制 subagent 先读格式规范，避免格式错误
- **统一验证**：最后统一检查，确保风格一致性

## 转换需求

需要将以下内容转换为正确的 Skill 格式：

| 源文件 | 目标 Skill | 说明 |
|--------|-----------|------|
| `.cursor/commands/speckit.specify.md` | `skills/specify/SKILL.md` | 需求规范化 |
| `.cursor/commands/speckit.plan.md` | `skills/plan/SKILL.md` | 技术规划 |
| `.cursor/commands/speckit.tasks.md` | `skills/tasks/SKILL.md` | 任务分解 |
| `.cursor/commands/speckit.implement.md` | `skills/implement/SKILL.md` | 代码实现 |
| `.cursor/commands/speckit.analyze.md` | `skills/analyze/SKILL.md` | 一致性检查 |
| `.cursor/commands/speckit.checklist.md` | `skills/checklist/SKILL.md` | 质量清单 |

### 转换要点

1. **提取核心指令** - 删除 bash 脚本调用
2. **改写触发方式** - 使用 `description` 描述触发场景
3. **移除变量** - 将 `$ARGUMENTS` 改为自然语言描述
4. **简化流程** - 移除脚本相关的步骤描述

## 相关目录

| 路径 | 说明 |
|------|------|
| `.cursor/commands/` | Cursor 命令源文件（需要转换） |
| `skill_demo/` | ❌ 格式错误，需要重构 |
| `.specify/` | 遗留目录，包含模板（迁移到 references/）和 bash 脚本（逻辑需转换） |

## 参考

- `skill-creator/SKILL.md` - Skill 创建规范（标准格式参考）
