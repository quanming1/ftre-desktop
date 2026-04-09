# 技术设计：转换 Cursor 命令为 Skill

> **架构概要：** 将 8 个 Cursor 命令转换为 8 个独立的 Skill 目录，每个包含 SKILL.md 和可选的 references/

## 目录结构设计

```
skill_demo/
├── specify/
│   ├── SKILL.md
│   └── references/
│       └── spec-template.md
├── plan/
│   ├── SKILL.md
│   └── references/
│       └── plan-template.md
├── tasks/
│   ├── SKILL.md
│   └── references/
│       └── tasks-template.md
├── implement/
│   └── SKILL.md
├── analyze/
│   └── SKILL.md
├── checklist/
│   └── SKILL.md
├── clarify/
│   └── SKILL.md
└── constitution/
    └── SKILL.md
```

## 每个 Skill 的核心职责

### specify
- **触发**：用户想创建功能规范、规范化需求
- **输入**：功能描述
- **输出**：`.ftre/specs/{feature}/spec.md`

### plan
- **触发**：用户想制定技术方案、架构设计
- **输入**：已有 spec.md
- **输出**：`plan.md`, `research.md`, `data-model.md`, `contracts/`

### tasks
- **触发**：用户想分解任务、生成任务清单
- **输入**：已有 spec.md + plan.md
- **输出**：`tasks.md`

### implement
- **触发**：用户想开始实现、写代码
- **输入**：已有 tasks.md
- **输出**：源代码文件

### analyze
- **触发**：用户想检查一致性、分析文档
- **输入**：spec.md + plan.md + tasks.md
- **输出**：分析报告（只读）

### checklist
- **触发**：用户想生成检查清单、质量验证
- **输入**：检查类型
- **输出**：`checklists/{type}.md`

### clarify
- **触发**：用户想澄清需求、解决歧义
- **输入**：带有 [需要澄清] 标记的 spec.md
- **输出**：更新后的 spec.md

### constitution
- **触发**：用户想定义项目原则、开发规范
- **输入**：项目原则描述
- **输出**：`.ftre/constitution.md`

## 必读文件映射

| Skill | 必须阅读的 Cursor 命令 |
|-------|---------------------|
| specify | `.cursor/commands/speckit.specify.md` |
| plan | `.cursor/commands/speckit.plan.md` |
| tasks | `.cursor/commands/speckit.tasks.md` |
| implement | `.cursor/commands/speckit.implement.md` |
| analyze | `.cursor/commands/speckit.analyze.md` |
| checklist | `.cursor/commands/speckit.checklist.md` |
| clarify | `.cursor/commands/speckit.clarify.md` |
| constitution | `.cursor/commands/speckit.constitution.md` |

## Skill 格式参考

必须阅读：`E:/binn/ai-base/app/skills/skill-creator/SKILL.md`

这个文件定义了 Skill 的正确格式和核心原则。
