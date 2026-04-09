# 任务清单：转换 Cursor 命令为 Skill 格式

> **目标：** 将 `.cursor/commands/speckit.*.md` 转换为 `skill_demo/` 格式的 skill 文件，并更新相关文档
> **背景：** 我们的应用没有命令功能，需要使用 skill 格式。之前有 agent 不理解 skill 格式，生成了错误的内容。

---

## 文件对照表

| Cursor 命令 | Skill 文件 | 状态 |
|------------|-----------|------|
| `.cursor/commands/speckit.specify.md` | `skill_demo/specify.md` | 需要更新 |
| `.cursor/commands/speckit.plan.md` | `skill_demo/plan.md` | 需要更新 |
| `.cursor/commands/speckit.tasks.md` | `skill_demo/tasks.md` | 需要更新 |
| `.cursor/commands/speckit.implement.md` | `skill_demo/implement.md` | 需要更新 |
| `.cursor/commands/speckit.analyze.md` | `skill_demo/analyze.md` | 需要更新 |
| `.cursor/commands/speckit.checklist.md` | `skill_demo/checklist.md` | 需要更新 |
| `.cursor/commands/speckit.clarify.md` | 新增 `skill_demo/clarify.md` | 需要创建 |
| `.cursor/commands/speckit.constitution.md` | 新增 `skill_demo/constitution.md` | 需要创建 |

---

## Skill 格式规范

### 结构要求

```markdown
# {Skill 名称} - {一句话描述}

{详细描述这个 skill 做什么}

## 触发方式

用户输入 `/{skill名}` 或描述中包含 "{关键词1}"、"{关键词2}" 等意图。

## 前置条件（如有）

- 条件 1
- 条件 2

## 输入

用户提供的输入描述。

## 执行流程

### 1. 步骤一标题

详细描述...

### 2. 步骤二标题

详细描述...

## 输出

描述输出的文件和内容。

## 关键原则

1. 原则一
2. 原则二

## 示例

**输入**：
```
示例输入
```

**输出摘要**：
```
示例输出
```
```

### 关键差异（Cursor 命令 vs Skill）

| 项目 | Cursor 命令 | Skill |
|------|------------|-------|
| 前置元数据 | 有 `---` YAML 前置 | 无 |
| 脚本依赖 | 依赖 `.specify/scripts/bash/*.sh` | 不依赖脚本，AI 直接执行 |
| 变量 | 使用 `$ARGUMENTS` | 使用"用户输入" |
| 路径 | 要求绝对路径 | 使用 `.ftre/specs/` 相对路径 |
| 目录结构 | `.specify/` | `.ftre/` |
| 命令前缀 | `/speckit.xxx` | `/xxx` |

---

## Task 1: 更新 specify.md [可并行]

**文件：** `skill_demo/specify.md`

**参考：** `.cursor/commands/speckit.specify.md`

**要点：**
1. 移除脚本调用（`create-new-feature.sh` 等）
2. 将 `$ARGUMENTS` 改为"用户输入的功能描述"
3. 将 `.specify/` 路径改为 `.ftre/`
4. 保留核心逻辑：解析需求 → 生成 spec.md → 质量验证 → 澄清问题
5. 保留示例和原则

---

## Task 2: 更新 plan.md [可并行]

**文件：** `skill_demo/plan.md`

**参考：** `.cursor/commands/speckit.plan.md`

**要点：**
1. 移除脚本调用（`setup-plan.sh` 等）
2. 保留阶段 0（研究）和阶段 1（设计）的核心流程
3. 移除"代理上下文更新"（`update-agent-context.sh`）
4. 保留输出结构：plan.md, research.md, data-model.md, contracts/

---

## Task 3: 更新 tasks.md (skill) [可并行]

**文件：** `skill_demo/tasks.md`

**参考：** `.cursor/commands/speckit.tasks.md`

**要点：**
1. 移除脚本调用（`check-prerequisites.sh` 等）
2. 保留任务生成规则（按用户故事组织、并行标记等）
3. 保留阶段结构：设置 → 基础 → 用户故事 → 完善

---

## Task 4: 更新 implement.md [可并行]

**文件：** `skill_demo/implement.md`

**参考：** `.cursor/commands/speckit.implement.md`

**要点：**
1. 移除脚本调用
2. 保留检查清单状态检查逻辑
3. 保留执行规则（TDD、分阶段、进度跟踪）
4. 保留完成验证逻辑

---

## Task 5: 更新 analyze.md [可并行]

**文件：** `skill_demo/analyze.md`

**参考：** `.cursor/commands/speckit.analyze.md`

**要点：**
1. 保留一致性检查逻辑
2. 保留问题分类（关键/重要/次要）
3. 强调只读操作

---

## Task 6: 更新 checklist.md [可并行]

**文件：** `skill_demo/checklist.md`

**参考：** `.cursor/commands/speckit.checklist.md`

**要点：**
1. 保留预置类型（需求质量、安全、UX、API、可访问性）
2. 保留自定义检查清单生成逻辑

---

## Task 7: 创建 clarify.md [可并行]

**文件：** `skill_demo/clarify.md`（新建）

**参考：** `.cursor/commands/speckit.clarify.md`

**要点：**
1. 需求澄清流程
2. 问题格式化和选项呈现
3. 规范更新逻辑

---

## Task 8: 创建 constitution.md [可并行]

**文件：** `skill_demo/constitution.md`（新建）

**参考：** `.cursor/commands/speckit.constitution.md`

**要点：**
1. 项目原则定义
2. 开发规范
3. 宪章文件生成

---

## Task 9: 更新 README.md [依赖 Task 1-8]

**文件：** `skill_demo/README.md`

**要点：**
1. 添加新的 skill（clarify, constitution）
2. 确保所有 skill 名称一致
3. 更新目录结构说明

---

## Task 10: 更新命令快速参考.md [依赖 Task 1-8]

**文件：** `命令快速参考.md`

**要点：**
1. 将 `/speckit.xxx` 改为 `/xxx`
2. 更新路径从 `.specify/` 到 `.ftre/`
3. 移除脚本相关描述
4. 保持内容结构不变

---

## Task 11: 清理 .specify 目录 [可选]

**目录：** `.specify/`

**要点：**
1. 保留 `templates/` 下的模板文件（移动到 `skill_demo/templates/` 或 `.ftre/templates/`）
2. `scripts/bash/` 不再需要
3. `memory/constitution.md` 可以作为示例保留

---

## 验证方式

1. 每个 skill 文件结构一致
2. 不包含脚本调用
3. 不包含 `$ARGUMENTS` 变量
4. 路径使用 `.ftre/specs/`
5. README.md 中列出的 skill 与实际文件一致
