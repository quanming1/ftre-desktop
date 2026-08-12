# ftre-desktop 项目开发规则（AGENTS.md）

本文件是 ftre-desktop 仓库对**所有 AI agent** 以及人类协作者的行为规范。
任何人在本仓库动手前，必须完整阅读并遵守本文件；git 操作**强制遵循 Git Flow**（见 §3）。

## 1. 项目概况

- **ftre-desktop**：ftre 生态的桌面客户端（Electron + React + pnpm workspace）
- 包结构：
  - `packages/electron` — 主进程（窗口管理 / IPC / 内嵌 Python 后端 spawn）
  - `packages/renderer` — React 前端（聊天 / Inspector / 文件树 / 设置 / 终端）
  - `packages/shared` — 共享类型（WS 协议 / IPC 类型）
  - `packages/ui` — 通用 UI 组件
- 关键文档：
  - `docs/TODO.yaml` — 结构化 TODO 清单（**开发的唯一执行依据**）
  - `docs/COMMIT.md` — 提交规范完整定义
  - `docs/PROCESS.md` — PRD 驱动开发流程
  - `docs/prd/` — 各阶段 PRD 文档

## 2. 工作方式

1. **严格按 `docs/TODO.yaml` 的阶段顺序推进**——每步只做该步清单内的任务。
2. 每阶段完成标准：代码 + 测试 + 文档 + 可独立验收（对照 PRD「验收标准」）。
3. 动手前先读相关文档与现有代码，遵循已有模式与风格。
4. 不引入未声明的依赖；用任何库前先确认已在 `package.json` 声明。
5. 只改任务范围内的文件；不做用户没要求的额外改动。

## 3. Git Flow 规范（强制）

### 3.1 分支模型

```
master            ← 仅存放可发布版本（受保护语义：永不直接提交）
  └─ develop      ← 日常集成分支（默认工作基底）
       ├─ feature/<阶段id>-<name>   新功能 / 新任务
       ├─ prd-update                PRD 文档专用分支
       ├─ todos-update              TODO 文档专用分支
       ├─ release/<ver>             发布准备
       └─ hotfix/<name>             生产紧急修复
```

### 3.2 分支规则

- 默认工作分支是 **develop**；master 永不直接提交代码；**develop 同样禁止直接提交，只接受 feature/* → merge 合入**（pre-push hook 强制）。
- 每个任务/功能开独立分支：`git checkout -b feature/<阶段id>-<short-name> develop`，**feat/fix 分支名必须关联 TODO 阶段 id**（如 `feature/A2-chat-ui`，大小写不敏感）。
- **交叉校验**：feat/fix 提交的 scope 必须与分支名中的阶段 id 一致（commit-msg hook 强制）。
- 规划类专用分支：`prd-update`（PRD 文档提交）、`todos-update`（TODO 文档提交）。

### 3.3 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>
```

- **subject 使用中文**（type/scope 保持英文）。
- type：`feat` / `fix` / `prd` / `todos` / `docs` / `refactor` / `test` / `style` / `chore` / `perf`
- **scope 分三类**：
  - `feat` / `fix` / `prd` / `todos`：scope **必须**是 `docs/TODO.yaml` 中的阶段 id（如 `A2` / `B1`），且必须真实存在（commit-msg hook 实时校验）
  - `prd` / `todos` 额外强制：只在 `prd-update` / `todos-update` 分支下提交，且暂存文件必须全部在 `docs/` 下
  - 其他 type（docs/refactor/test/style/chore/perf）：scope 用模块名，白名单定义在 `.githooks/.scopes`（chat/ws/inspector/electron/session/editor/explorer/git/settings/shared/tests/docs）
- **一条提交只做一件事**；禁止 `fix stuff`、`update`、`misc` 这类无意义 message。
- **本地强制**：`.githooks/commit-msg` hook 每次 commit 校验，不符合直接拒绝。
- 提交规范完整定义见 `docs/COMMIT.md`。

### 3.4 合并策略

- `feature/*` → `develop`：**`git merge --no-ff feature/xxx`**（保留合并提交）。
- **develop 只接受 merge 合入**：禁止直接 commit 到 develop（pre-push hook 校验）。
- `develop` → `master`：走 `release/*`。
- **禁止 rebase 重写已推送历史**。

### 3.5 本地保护（hooks）

- `.githooks/commit-msg`：提交时校验消息格式/type/scope/阶段 id/分支交叉
- `.githooks/pre-push`：禁止非 master 分支 push 到 master、禁止删除 master、develop 新增提交必须全部是 merge commit
- `merge:` / `Merge` / `revert:` / `Revert` 开头的系统提交自动跳过
- hook 生效前提：`git config core.hooksPath .githooks`（新 clone 后执行一次）

### 3.6 标准流程（每次任务）

```bash
git checkout develop && git pull          # 1. 同步基底
git checkout -b feature/<阶段id>-<task>   # 2. 开任务分支
# ... 开发 + 本地测试（pnpm test / tsc）...
git add <改动文件>                          # 3. 提交（conventional）
git commit -m "feat(A2): 描述"
git checkout develop && git merge --no-ff feature/<task>   # 4. 合并回 develop
git push origin develop                   # 5. 推送
```

## 4. PRD 驱动开发（强制）

- **先 PRD，后开发**：每个 TODO 阶段开工前，必须先创建对应 PRD（`docs/prd/PRD-<阶段>-<名称>.md`，从模板复制），定稿（`approved`）后才能开发。
- **PRD 是开发的唯一依据**：需求、实现、测试、验收全部对照 PRD；禁止开发 PRD 未定义的内容。
- **验收按 PRD 标准**：每阶段完成必须按 PRD「验收标准」逐条核对。
- 推进管理办法详见 `docs/PROCESS.md`；阶段状态与阶段 id 见 `docs/TODO.yaml`。

## 5. 测试

- 测试框架：**vitest**（`packages/renderer/src/**/*.test.ts(x)`）。
- 每个新功能必须配测试；每个 bug 修复必须配回归测试。
- 提交/合并前本地必须通过：`pnpm test` + 类型检查。

## 6. 禁止事项

- 直接向 master 提交 / 推送代码。
- 把 secrets / API key 提交进仓库。
- 遗留临时文件、调试代码、`.bak`、未使用的死代码。
- 提交时夹带与任务无关的改动。
