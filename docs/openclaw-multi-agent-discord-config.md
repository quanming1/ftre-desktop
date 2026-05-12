ftre-desktop\docs\openclaw-multi-agent-discord-config.md
```

# OpenClaw 多 Agent 频道配置指南

> 本文档介绍如何使用 Discord 频道隔离不同角色，实现多 Agent 协作架构。

---

## 目录

1. [核心架构](#核心架构)
2. [关键概念](#关键概念)
3. [创建 Discord 频道](#创建-discord-频道)
4. [获取频道 ID](#获取频道-id)
5. [创建 Agent Workspace](#创建-agent-workspace)
6. [配置 openclaw.json](#配置-openclawjson)
7. [重启并验证](#重启并验证)

---

## 核心架构

这是一个**一人软件公司模型**，用 Discord 的频道来隔离不同角色。每个频道有自己的工作空间、模型、人设、会话 session 等。

频道间互不影响，并且能发挥模型的最大能力。前端强的模型来做前端的事，后端强的来做后端的事。

```
┌─────────────────────────────────────────────────────────────┐
│                      Discord 服务器                          │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  #产品经理    │  │   #UI设计    │  │  #前端开发    │       │
│  │  频道ID: A   │  │  频道ID: B   │  │  频道ID: C   │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                 │
│                    ┌──────▼───────┐                         │
│                    │  1个 Discord │                         │
│                    │     Bot      │                         │
│                    │  Token: xxx  │                         │
│                    └──────┬───────┘                         │
│                           │                                 │
│              频道ID → bindings 匹配                         │
│                    ┌──────▼───────┐                         │
│                    │   OpenClaw   │                         │
│                    │   Gateway    │                         │
│                    └──────┬───────┘                         │
│                           │ 路由到对应 Agent                │
│         ┌─────────────────┼─────────────────┐               │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐          │
│  │   产品经理   │  │   设计师    │  │    前端     │          │
│  │  workspace  │  │  workspace  │  │  workspace  │          │
│  │  SOUL.md    │  │  SOUL.md    │  │  SOUL.md    │          │
│  │  MEMORY.md  │  │  MEMORY.md  │  │  MEMORY.md  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### 架构组成

| 组件 | 数量 | 说明 |
|------|------|------|
| Discord 频道 | 5 个 | 产品、设计、前端、后端、测试 |
| Agent | 5 个 | 每个有独立 workspace |
| Bot | 1 个 | 只有一个 Token，在所有频道中在线 |

### 5 个频道

| 角色 | 频道 ID | 说明 |
|------|---------|------|
| 产品经理 | xxxA | 产品经理工作区 |
| UI 设计 | xxxB | UI 设计师工作区 |
| 前端开发 | xxxC | 前端工程师工作区 |
| 后端开发 | xxxD | 后端工程师工作区 |
| 测试 | xxxE | 测试工程师工作区 |

### 5 个 Agent Workspace

| Agent | Workspace 路径 |
|-------|----------------|
| 产品 | `~/.openclaw/discord/workspace-product` |
| 设计 | `~/.openclaw/discord/workspace-design` |
| 前端 | `~/.openclaw/discord/workspace-frontend` |
| 后端 | `~/.openclaw/discord/workspace-backend` |
| 测试 | `~/.openclaw/discord/workspace-qa` |

---

## 关键概念

### Workspace

每个 Agent 都有自己独立的 workspace 目录，包含：

| 文件 | 说明 |
|------|------|
| `SOUL.md` | Agent 的人设、角色定位、能力边界 |
| `MEMORY.md` | Agent 的长期记忆和历史对话 |
| 其他配置文件 | 可选的模型和参数配置 |

### 为什么需要独立 Workspace？

- **人设独立**：每个 Agent 有不同的 SOUL.md，形成不同的人格
- **记忆隔离**：不同 Agent 的对话历史互不干扰
- **配置灵活**：可以为每个 Agent 设置不同的参数和提示词
- **干净、隔离、不串味**：真正实现功能隔离

---

## 创建 Discord 频道

1. 进入你的 Discord 服务器
2. 点击频道列表旁边的 "+" 按钮
3. 选择 "Create Channel"
4. 为每个 Agent 创建一个专用频道

### 频道设置建议

| 设置项 | 建议 |
|--------|------|
| 频道类型 | 私享频道（Private Channel），仅允许特定成员访问 |
| Emoji 前缀 | 为每个频道添加对应的 Emoji 便于识别 |
| 频道描述 | 说明该频道的用途 |
| 子频道 | 可以为每个频道创建子频道，用于项目讨论 |

### 频道命名参考

| 角色 | 频道名称 | 描述 |
|------|----------|------|
| 产品经理 | 产品 | 产品经理工作区 |
| UI 设计 | 设计 | UI 设计师工作区 |
| 前端 | 前端 | 前端工程师工作区 |
| 后端 | 后端 | 后端工程师工作区 |
| 测试 | 测试 | 测试工程师工作区 |

---

## 获取频道 ID

1. 打开 Discord 客户端
2. 进入 Settings → Advanced
3. 开启 Developer Mode
4. 右键点击每个频道，选择 "Copy ID"
5. 将所有频道 ID 记录下来

---

## 创建 Agent Workspace

### 创建目录结构

```bash
mkdir -p ~/.openclaw/discord/workspace-product
mkdir -p ~/.openclaw/discord/workspace-design
mkdir -p ~/.openclaw/discord/workspace-frontend
mkdir -p ~/.openclaw/discord/workspace-backend
mkdir -p ~/.openclaw/discord/workspace-qa
```

### SOUL.md 示例

#### 产品经理的 SOUL.md

```markdown
# 人设

你是一位经验丰富的产品经理，擅长需求分析、用户故事编写、产品规划。

## 核心职责

1. 分析用户需求，提取关键信息
2. 编写清晰的用户故事和需求文档
3. 协助产品决策和优先级排序
4. 提供产品思维和最佳实践建议

## 工作方式

- 始终保持专业、清晰的沟通风格
- 用结构化的方式表达需求
- 注重用户价值和产品目标

## 边界

- 不提供具体的技术实现方案（交给开发团队）
- 不提供 UI 设计细节（交给设计团队）
```

#### 前端工程师的 SOUL.md

```markdown
# 人设

你是一位资深的前端工程师，精通 React、Vue、TypeScript 等现代前端技术。

## 技术栈

- React, Vue, TypeScript
- Tailwind CSS, SCSS
- Next.js, Vite
- 状态管理: Redux, Zustand

## 核心职责

1. 前端架构设计和技术选型
2. 代码审查和最佳实践建议
3. 性能优化和调试
4. 组件设计和状态管理

## 工作方式

- 提供具体、可执行的代码建议
- 解释代码的原理和设计思路
- 遵循 Clean Code 原则

## 边界

- 不提供服务器端配置（后端工程师负责）
- 不提供部署脚本（DevOps 负责）
- 不提供 UI 设计稿（UI 设计师负责）
```

### CONFIG.json（可选）

每个 workspace 目录下可以创建 `CONFIG.json` 来指定模型和参数。

#### 参数说明

| 参数 | 类型 | 说明 | 推荐值 |
|------|------|------|--------|
| model | string | 使用的 AI 模型 | claude-3-sonnet, claude-3-haiku |
| temperature | number | 生成随机性（0-2） | 产品 0.7，设计 0.8，前端 0.6，后端 0.5，测试 0.6 |
| maxTokens | number | 最大生成 Token 数 | 前端/后端 8192，其他 4096 |
| memoryLimit | number | 记忆限制 | 500-1000 |

#### 示例配置

**产品经理的 CONFIG.json**

```json
{
  "model": "claude-3-sonnet",
  "temperature": 0.7,
  "maxTokens": 4096,
  "memoryLimit": 500
}
```

**UI 设计师的 CONFIG.json**

```json
{
  "model": "claude-3-sonnet",
  "temperature": 0.8,
  "maxTokens": 4096,
  "memoryLimit": 500
}
```

**后端工程师的 CONFIG.json**

```json
{
  "model": "claude-3-sonnet",
  "temperature": 0.5,
  "maxTokens": 8192,
  "memoryLimit": 1000
}
```

**测试工程师的 CONFIG.json**

```json
{
  "model": "claude-3-sonnet",
  "temperature": 0.6,
  "maxTokens": 4096,
  "memoryLimit": 500
}
```

---

## 配置 openclaw.json

配置文件分为三个部分：定义 Agent、开启 Discord、写 bindings。

### 完整配置示例

```json
{
  "//==========第一部分：定义Agent==========": "",
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-6",
        "fallbacks": [
          "openai-codex/gpt-5.3-codex",
          "google-antigravity/claude-opus-4-6-thinking"
        ]
      }
    },
    "list": [
      {
        "id": "main",
        "default": true,
        "identity": {
          "name": "小管家",
          "emoji": "🤖"
        },
        "model": {
          "primary": "anthropic/claude-opus-4-6",
          "fallbacks": [
            "openai-codex/gpt-5.3-codex",
            "google-antigravity/claude-opus-4-6-thinking"
          ]
        }
      },
      {
        "id": "product",
        "workspace": "/root/.openclaw/discord/workspace-product",
        "identity": {
          "name": "产品经理",
          "emoji": "📋"
        }
      },
      {
        "id": "designer",
        "workspace": "/root/.openclaw/discord/workspace-design",
        "identity": {
          "name": "设计师",
          "emoji": "🎨"
        }
      },
      {
        "id": "frontend",
        "workspace": "/root/.openclaw/discord/workspace-frontend",
        "identity": {
          "name": "前端",
          "emoji": "💻"
        }
      },
      {
        "id": "backend",
        "workspace": "/root/.openclaw/discord/workspace-backend",
        "identity": {
          "name": "后端",
          "emoji": "🔧"
        }
      },
      {
        "id": "qa",
        "workspace": "/root/.openclaw/discord/workspace-qa",
        "identity": {
          "name": "测试",
          "emoji": "🧪"
        }
      }
    ]
  },

  "//==========第二部分：开启Discord==========": "",
  "channels": {
    "discord": {
      "enabled": true,
      "token": "你的BOT_TOKEN",
      "groupPolicy": "open",
      "guilds": {
        "你的服务器ID": {
          "channels": {
            "产品经理频道ID": {
              "allow": true,
              "requireMention": false
            },
            "UI设计频道ID": {
              "allow": true,
              "requireMention": false
            },
            "前端开发频道ID": {
              "allow": true,
              "requireMention": false
            },
            "后端开发频道ID": {
              "allow": true,
              "requireMention": false
            },
            "测试频道ID": {
              "allow": true,
              "requireMention": false
            }
          }
        }
      }
    }
  },

  "//==========第三部分：写bindings（频道→Agent路由）==========": "",
  "bindings": [
    {
      "agentId": "product",
      "match": {
        "channel": "discord",
        "peer": {
          "kind": "channel",
          "id": "产品经理频道ID"
        },
        "guildId": "你的服务器ID"
      }
    },
    {
      "agentId": "designer",
      "match": {
        "channel": "discord",
        "peer": {
          "kind": "channel",
          "id": "UI设计频道ID"
        },
        "guildId": "你的服务器ID"
      }
    },
    {
      "agentId": "frontend",
      "match": {
        "channel": "discord",
        "peer": {
          "kind": "channel",
          "id": "前端开发频道ID"
        },
        "guildId": "你的服务器ID"
      }
    },
    {
      "agentId": "backend",
      "match": {
        "channel": "discord",
        "peer": {
          "kind": "channel",
          "id": "后端开发频道ID"
        },
        "guildId": "你的服务器ID"
      }
    },
    {
      "agentId": "qa",
      "match": {
        "channel": "discord",
        "peer": {
          "kind": "channel",
          "id": "测试频道ID"
        },
        "guildId": "你的服务器ID"
      }
    }
  ]
}
```

### 配置说明

#### requireMention: false（关键）

| 配置 | 场景 | 说明 |
|------|------|------|
| `false` | 自用服务器 | 直接设为 false，不需要每次说话都 @Bot |
| `true` | 公开服务器 | 建议设为 true，避免机器人响应所有消息 |

#### workspace

- 每个 Agent 指向独立的 workspace 目录
- 不同 workspace = 不同人格
- 包含 SOUL.md、MEMORY.md 等配置文件

#### identity.emoji

- 每个 Agent 有自己的 emoji
- 用于区分不同 Agent 的回复

#### bindings（核心）

- 定义频道到 Agent 的路由规则
- 通过 `peer.id` 匹配频道 ID
- 通过 `agentId` 指定对应的 Agent

---

## 重启并验证

### 重启 Gateway

```bash
openclaw gateway restart
```

### 验证方法

去每个频道发句话测试：

```
# 产品经理频道
用户：你好产品经理
📋：你好！我是产品经理，有什么需求需要分析吗？

# 前端开发频道
用户：你好前端
💻：你好！我是前端工程师，有什么代码问题需要我帮忙吗？
```

### 验证标准

| 检查项 | 预期结果 |
|--------|----------|
| Emoji 正确 | 产品经理 📋、前端 💻、后端 🔧 |
| 人设正确 | 根据 SOUL.md 定义的回复风格 |
| Emoji 对了 | 路由就没问题 |