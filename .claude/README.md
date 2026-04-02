# .claude 目录

此目录包含 Claude AI 助手的配置和知识文件。

## 目录结构

```
.claude/
├── README.md          # 本说明文件
└── skills/            # 技能文档目录
    └── deep-interaction-analysis.md  # 深度交互分析方法
```

## Skills（技能）

Skills 是可复用的工作方法论，记录了解决特定类型问题的系统性方法。

### 当前技能列表

| 技能 | 描述 | 适用场景 |
|------|------|----------|
| [deep-interaction-analysis](skills/deep-interaction-analysis.md) | 深度交互分析 | UI 组件审查、UX 问题排查 |

## 使用方式

在与 Claude 对话时，可以引用这些技能：

- "使用深度交互分析方法检查这个组件"
- "按照 skill 文档的模式分析这个功能"

## 添加新技能

当发现有效的工作模式时，可以将其记录为新的 skill：

1. 在 `skills/` 目录下创建 `.md` 文件
2. 包含：概述、适用场景、步骤、示例、关键原则
3. 更新本 README 的技能列表