# ftre 提交规范（Commit Convention）

> 本仓库所有提交（commit）必须遵循本规范，由 `.githooks/commit-msg` hook 在提交时**强制校验**，
> 不符合直接拒绝提交。AGENTS.md Git Flow 章节为规范速览，本文为完整定义。

## 1. 为什么要有提交规范

- **可追溯**：每条提交都能对应到 TODO 的具体阶段（`docs/TODO.yaml`），回看历史就知道"这一步是给哪个阶段写的"
- **可生成**：规范的 `<type>(<scope>)` 结构可被工具消费（CHANGELOG 生成、版本发布、代码审查筛选）
- **防手滑**：阶段号写错、type 拼错会在提交时被当场拦下，而不是污染历史

## 2. 格式总览

```
<type>(<scope>): <subject>
```

- `type`：本次提交的类型（必填，白名单见 §3）
- `scope`：本次提交的作用域（必填，规则见 §4）
- `subject`：一句话描述（**中文**；type/scope 保持英文；不超过 50 字符为宜）

### 多行消息（正文）

需要补充说明时用 `-m` 追加正文段落（正文不参与 hook 校验，但建议写"为什么"）：

```bash
git commit -m "feat(B1): SessionLane mailbox 架构" -m "- MailboxStore 持久队列 + CompletionRegistry 精确等待"
```

## 3. type 白名单（必填其一）

| type | 含义 | 示例 |
|---|---|---|
| `feat` | 新功能（必须带阶段标识，见 §4.1） | `feat(A2): 添加变量替换` |
| `fix` | 修复 bug（必须带阶段标识，见 §4.1） | `fix(C1): checkpoint 落盘失败` |
| `docs` | 文档变更 | `docs(agent): 更新架构说明` |
| `refactor` | 重构（行为不变） | `refactor(bus): 抽取 TypedBusMessage` |
| `test` | 测试相关 | `test(session): 添加 mailbox 测试` |
| `style` | 格式/风格（不影响行为） | `style(api): 统一参数顺序` |
| `chore` | 构建/工具/杂项 | `chore(tests): 更新 CI 依赖版本` |
| `perf` | 性能优化 | `perf(agent): 缓存配置读取` |
| `prd` | PRD 文档（专用：见 §4.3） | `prd(C2): 添加 multi-loop 编排 PRD` |
| `todos` | TODO 清单 / 规划文档（专用：见 §4.3） | `todos(G1): 更新 C2 状态为进行中` |

**禁止** `fix stuff`、`update`、`misc` 这类无意义消息；**一条提交只做一件事**。

## 4. scope 规则

### 4.1 feat / fix / prd / todos：必须用 TODO 阶段标识

scope 必须是 `docs/TODO.yaml` 中的阶段 id（如 `A1`、`C2`、`G1`），
表明本次改动**属于**（feat）或**修复了**（fix）哪个阶段的功能，或**规划了**（prd / todos）哪个阶段的文档。

**列号规则**：阶段超过 Z 时延续 Excel 列编号风格——`A`…`Z` 之后为 `AA`、`AB`…（对应阶段 id 形如 `AA1`、`AB2`）。

**存在性校验**：hook 解析 `docs/TODO.yaml` 实时比对，阶段 id 不存在（或写错）直接拒绝，
并列出当前全部可用阶段。

**feat 带 PRD 校验（强制）**：`feat` 提交的暂存区必须包含对应阶段 PRD 文件（`docs/prd/PRD-<scope>-*.md`）——行为变更必须同步 PRD 的「变更记录」。无 PRD 的基建阶段跳过。

**perf 带 FR 引用（强制）**：`perf` 的 scope 必须带 FR 引用，如 `perf(C2-FR6)` / `perf(C2-FR6,FR8)`——perf 表示"优化完善已有描述"，引用的 FR 编号必须真实存在于对应 PRD。

```bash
# 合法
git commit -m "feat(A2): 添加变量替换"
git commit -m "fix(C1): 落盘修复（修复 C1 阶段的功能）"

# 非法（会被 hook 拒绝）
git commit -m "feat(config): 新功能"        # feat 的 scope 必须是阶段标识
git commit -m "fix(ZZ9): 修复问题"          # ZZ9 不在 docs/TODO.yaml 中
```

**分支名交叉校验**：feat / fix 的**分支名必须关联阶段 id**（如 `feature/A2-config`，大小写不敏感），且 commit scope 必须与分支名中的 id **一致**。

```bash
git checkout -b feature/A2-config develop
git commit -m "feat(A2): 添加变量替换"       # 合法：分支 A2 == scope A2
git commit -m "feat(C1): 添加循环引擎"       # 拒绝：分支 A2 != scope C1
```

### 4.2 其他 type：用模块 scope

`docs` / `refactor` / `test` / `style` / `chore` 的 scope 用模块名，不强绑阶段。
各仓库的模块 scope 白名单定义在 `check_commit_msg.py` 顶部「裁剪点」的 `MODULE_SCOPES` 中。

### 4.3 prd / todos：专用分支 + 仅限文档

`prd`（PRD 文档）和 `todos`（TODO / 规划文档）是**规划类提交**，与代码开发隔离：

- **专用分支**：`prd` 提交必须在 `prd-update` 分支下；`todos` 提交必须在 `todos-update` 分支下
- **仅限文档**：暂存文件**必须全部在 `docs/` 下**——任何代码、测试文件直接拒绝提交
- scope 仍用阶段标识（§4.1）

## 5. 本地强制机制（hooks）

- `.githooks/commit-msg` 调用 `.githooks/check_commit_msg.py` 校验（type 白名单 / 阶段存在性 / feat 带 PRD / perf-FR / 分支名交叉校验 / prd·todos 专用约束）
- `.githooks/pre-push` **全 PR 流保护**：
  - **master 双重保护**：非 master 分支禁止 push 到 master；本地 master 领先的新增提交不得含本地 merge 提交（master 只接受 release/hotfix 合并后的发布推送）
  - **develop 三重保护**：禁止删除远程 develop；禁止非 develop 分支直推 develop（必须走 PR）；推送 develop 时本地领先远程（含本地 merge --no-ff 或直接 commit）即拒绝——develop 只接受 GitHub PR 服务器端合入
- `merge:` / `Merge` / `revert:` / `Revert` 开头的系统提交自动跳过
- hook 生效前提：`git config core.hooksPath .githooks`（新 clone 后执行一次）

## 6. 常见错误速查

| 错误写法 | 问题 | 正确写法 |
|---|---|---|
| `feat: 新功能` | 缺 scope | `feat(A2): 新功能` |
| `feat(config): 新功能` | feat 用了模块 scope | `feat(A1): 新功能` |
| `prd(C2): 写 PRD`（在 develop 上） | prd 必须在 prd-update 分支 | `git checkout -b prd-update develop` |
| `fix(AA9): 修复` | 阶段 id 不存在 | `fix(C2): 修复` |
| `feat(A2): 新功能`（在 feature/C1-x 分支） | scope 与分支名不一致 | 在 `feature/A2-x` 分支提交 |
| `update xxx` | 无 type/scope | `chore(tests): 更新依赖` |

## 7. 参考

- AGENTS.md Git Flow 章节（分支模型与合并策略）
- docs/TODO.yaml（阶段 id 的唯一事实源）
- [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)
