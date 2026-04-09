# 任务清单：转换 Cursor 命令为 Skill

> **目标：** 将 8 个 Cursor 命令转换为 8 个独立的 Skill
> **并行策略：** Task 1-8 可并行执行，Task 9 最后执行清理

---

## 通用指令（所有 Task 必读）

### 必读文件

1. **Skill 格式规范**：`E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
   - 理解 Skill 的正确格式
   - 理解 YAML frontmatter 要求
   - 理解渐进加载原则

2. **需求文档**：`.ftre/specs/convert-to-skills/requirements.md`
3. **设计文档**：`.ftre/specs/convert-to-skills/design.md`

### 转换规则

1. **YAML frontmatter 格式**：
```yaml
---
name: skill-name
description: 清晰描述做什么 + 何时触发（这是 AI 判断是否使用的唯一依据）
---
```

2. **移除**：
   - Cursor 的 `---` 前置元数据（替换为 Skill 格式）
   - `$ARGUMENTS` → 改为"用户输入"
   - `.specify/scripts/bash/*.sh` 脚本调用
   - 绝对路径要求

3. **修改**：
   - `.specify/` → `.ftre/`
   - `/speckit.xxx` → `/xxx`

4. **保持简洁**：
   - SKILL.md 控制在 500 行以内
   - 只包含 AI 执行任务需要的信息
   - 不要冗余解释

---

## Task 1: 创建 specify Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.specify.md`

**输出**：
- 创建目录 `skill_demo/specify/`
- 创建 `skill_demo/specify/SKILL.md`

**description 示例**：
```
将用户的功能需求描述转化为结构化的规范文档。当用户想要规范化需求、创建功能规范、或说"帮我写需求文档"时触发。
```

---

## Task 2: 创建 plan Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.plan.md`

**输出**：
- 创建目录 `skill_demo/plan/`
- 创建 `skill_demo/plan/SKILL.md`

**description 示例**：
```
根据功能规范制定技术实现方案。当用户想要技术设计、架构规划、或已有 spec.md 需要制定实现计划时触发。
```

---

## Task 3: 创建 tasks Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.tasks.md`

**输出**：
- 创建目录 `skill_demo/tasks/`
- 创建 `skill_demo/tasks/SKILL.md`

**description 示例**：
```
将技术方案分解为可执行的任务清单。当用户想要分解任务、生成实现步骤、或已有 plan.md 需要任务拆分时触发。
```

---

## Task 4: 创建 implement Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.implement.md`

**输出**：
- 创建目录 `skill_demo/implement/`
- 创建 `skill_demo/implement/SKILL.md`

**description 示例**：
```
按任务清单逐步实现功能代码。当用户想要开始编码、实现功能、或已有 tasks.md 准备执行时触发。
```

---

## Task 5: 创建 analyze Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.analyze.md`

**输出**：
- 创建目录 `skill_demo/analyze/`
- 创建 `skill_demo/analyze/SKILL.md`

**description 示例**：
```
检查 spec、plan、tasks 三个文档的一致性。当用户想要验证文档一致性、检查遗漏、或在实现前做最终审查时触发。只读操作，不修改文件。
```

---

## Task 6: 创建 checklist Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.checklist.md`

**输出**：
- 创建目录 `skill_demo/checklist/`
- 创建 `skill_demo/checklist/SKILL.md`

**description 示例**：
```
生成需求质量验证检查清单。当用户想要质量检查、安全审查、UX 验证、或创建自定义检查清单时触发。
```

---

## Task 7: 创建 clarify Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.clarify.md`

**输出**：
- 创建目录 `skill_demo/clarify/`
- 创建 `skill_demo/clarify/SKILL.md`

**description 示例**：
```
解决规范中的模糊和歧义问题。当规范包含 [需要澄清] 标记、或用户想要澄清需求细节时触发。
```

---

## Task 8: 创建 constitution Skill [可并行]

**必读**：
- `E:/binn/ai-base/app/skills/skill-creator/SKILL.md`
- `.cursor/commands/speckit.constitution.md`

**输出**：
- 创建目录 `skill_demo/constitution/`
- 创建 `skill_demo/constitution/SKILL.md`

**description 示例**：
```
定义项目的核心原则和开发规范。当用户想要建立项目宪章、定义开发规范、或设置团队约定时触发。
```

---

## Task 9: 清理旧文件 [依赖 Task 1-8]

**操作**：

1. 删除 `skill_demo/` 根目录下的错误文件：
   - `skill_demo/README.md`
   - `skill_demo/specify.md`
   - `skill_demo/plan.md`
   - `skill_demo/tasks.md`
   - `skill_demo/implement.md`
   - `skill_demo/analyze.md`
   - `skill_demo/checklist.md`
   - `skill_demo/templates/`

2. 删除 `命令快速参考.md`

3. 可选：归档 `.specify/` 目录（或直接删除，因为脚本不再需要）

---

## 验证清单

- [ ] 每个 Skill 目录包含 SKILL.md
- [ ] 每个 SKILL.md 有正确的 YAML frontmatter（name + description）
- [ ] 不包含 `$ARGUMENTS`、脚本调用
- [ ] 路径使用 `.ftre/`
- [ ] SKILL.md 简洁，控制在 500 行以内
