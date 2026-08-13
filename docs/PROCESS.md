# ftre-desktop 项目推进管理办法（PROCESS.md）

> 本文件定义 ftre-desktop 的开发推进机制：**先 PRD，后开发**。任何阶段没有定稿的 PRD 不开工。
> PRD 是开发的唯一依据，验收以 PRD 的「验收标准」为准。

## 1. 核心原则

1. **先 PRD，后开发**：每个 TODO 阶段开工前，必须先有对应 PRD 文档并定稿（状态 `approved`）。
2. **一阶段一 PRD**：每个 TODO 阶段（A1 / A2 / B1 / C1 ...）对应一份 PRD 文档，位于 `docs/prd/`。
3. **PRD 即契约**：实现、测试、验收全部对照 PRD 执行；开发过程中不擅自扩大或缩小范围。

## 2. 六步闭环

```
立项 → 评审 → 开发 → 验证 → 收尾 → 发布
```

| 步骤 | 动作 | 产物 / 状态 |
|---|---|---|
| 1. 立项 | 从 `docs/TODO.yaml` 选定一个阶段，**TODO 标 `in_progress`**，撰写 PRD | `docs/prd/PRD-<阶段>-<名称>.md`（状态：草稿） |
| 2. 评审 | 逐条核对需求与验收标准，定稿 | PRD 状态：`approved`（定稿后冻结，变更需走「变更记录」） |
| 3. 开发 | 按 PRD 需求实现；Git Flow：`feature/<阶段>-<任务>` 分支 | 代码 + 测试；PRD 状态：开发中 |
| 4. 验证 | 对照 PRD「验收标准」逐条执行（pnpm test / tsc / 手动） | 全部通过 → 进入收尾；失败 → 回开发 |
| 5. 收尾 | **三联动缺一不可**：PRD 标 `已验收` + TODO 标 `done` + CHANGELOG 追加 `[未发布]` | push feature 分支 → GitHub PR 合入 develop（本地不 merge） |
| 6. 发布 | release 分支 + 版本冻结 + 回归 + tag | `release/<ver>` → master + tag `vX.Y.Z` |

## 3. PRD 文档规范

- **位置**：`docs/prd/`
- **命名**：`PRD-<阶段>-<名称>.md`，如 `PRD-A2-chat-ui.md`
- **模板**：`docs/prd/PRD-TEMPLATE.md`（新阶段一律从模板复制）
- **状态生命周期**：`草稿 → 评审 → approved（定稿）→ 开发中 → 已验收`；**禁止跳变**（approved / 已验收必须留档日期）
- **变更双路径**：
  - 属于原 PRD 范围（同阶段/同主题/对原 FR·AC 的修正细化）→ 修改正文 + **MUST 在末尾追加「变更记录」（日期 + 变更内容 + 理由）** + 重核受影响 AC（结果留痕，如"原 AC 不受影响"或"AC3 已重跑通过"）
  - 超出范围 / 新阶段 / 全新主题 → 新开 PRD（复制模板，走完整闭环）

## 4. 状态联动

| 文档 | 字段 | 流转时机 |
|---|---|---|
| `docs/TODO.yaml` | `status: in_progress` | 立项时（选阶段） |
| `docs/TODO.yaml` | `status: done` | 收尾时（验收通过） |
| `docs/prd/PRD-*.md` | 元信息「状态」 | 随六步闭环实时更新（MUST 流转，不跳变） |
| `docs/prd/PRD-*.md` 的「变更记录」 | 重大架构决策 / 需求变更 | 决策发生时；变更后 MUST 重核受影响 AC |
| `CHANGELOG.md` | `[未发布]` 追加 | 每次功能 / 修复 / 行为变更完成 |

## 5. 验收纪律

- 验收三步：`pnpm test`（自动化测试）+ `tsc`（类型检查）+ PRD 手动验收项。
- 未达标准不标记完成；反复失败要回到初始假设重新判断。

## 6. 与 Git Flow 的配合（全 PR 流）

- 每份 PRD 对应一个 feature 分支：`feature/<阶段>-<short-name>`。
- PRD 文档本身在立项阶段提交（`prd(<阶段>): 添加 <阶段> 阶段 PRD`，在 `prd-update` 分支），开发在 PRD 定稿后开始。
- 阶段合入：**push feature 分支 → GitHub PR/MR 合入 develop（全 PR 流，禁止本地 merge）**，遵循 AGENTS.md `<git_flow>`。

## 7. 存量项目反推（无 PRD/TODO 时）

项目已在开发中、从未建立 PRD/TODO 时，先反推再接管：

1. **梳理演进**：`git log --oneline --date=short`（按功能/版本分组）。
2. **分阶段**：按里程碑切成 N 个阶段（历史功能标 `done`，未来规划标 `todo`）。
3. **补 TODO**：每个阶段一行（含模块 + 验收标准 + 状态）。
4. **补 PRD**：从模板复制，FR/AC 从代码现状 + CHANGELOG + README 反推；状态按实际标 `已验收` / `approved`（备注"反推，待复核"）。

反推纪律：先分析再改；不破坏现有功能（每步后 lint/test/build 保持绿）；关键决策先问再定；反推不是编造（写不出的验收标准标"待复核"）。

## 8. 完整参考

- 完整流程图（六步闭环 + 变更双路径 + 存量反推入口）：见 Rondo 方法主文档 `https://quanming1.github.io/minimal-blog/posts/rondo-method/`
- 提交规范：AGENTS.md `<git_flow>` / `docs/COMMIT.md`
