# ftre 项目推进管理办法（PRD 驱动开发）

> 本文件定义 ftre 的开发推进机制：**先 PRD，后开发**。任何阶段没有定稿的 PRD 不开工。
> PRD 是开发的唯一依据，验收以 PRD 的「验收标准」为准。

---

## 1. 核心原则

1. **先 PRD，后开发**：每个 TODO 阶段开工前，必须先有对应 PRD 文档并定稿（状态 `approved`）。
2. **一阶段一 PRD**：每个 TODO 阶段（A1 / A2 / B1 / C1 ...）对应一份 PRD 文档，位于 `docs/prd/`。
3. **PRD 即契约**：实现、测试、验收全部对照 PRD 执行；开发过程中不擅自扩大或缩小范围。
4. **验收不通过 = 未完成**：PRD 验收标准逐条核对，全部通过才更新 TODO / CHANGELOG / 进入下一阶段。

## 2. 开发流程（六步闭环）

```
立项 → 评审 → 开发 → 验证 → 收尾 → 发布（可选）
```

| 步骤 | 动作 | 产物 / 状态 |
|---|---|---|
| 1. 立项 | 从 `docs/TODO.yaml` 选定一个阶段，撰写 PRD | `docs/prd/PRD-<阶段>-<名称>.md`（状态：草稿） |
| 2. 评审 | 逐条核对需求与验收标准，定稿 | PRD 状态：`approved` |
| 3. 开发 | 按 PRD 需求实现；Git Flow：`feature/<阶段>-<任务>` 分支 | 代码 + 测试；PRD 状态：开发中 |
| 4. 验证 | 对照 PRD「验收标准」逐条执行 | 全部通过 → 进入收尾；失败 → 回开发 |
| 5. 收尾 | 更新 TODO 状态、PRD 状态 `已验收` | 合并回 develop 并推送 |
| 6. 发布（可选） | release 分支 + 版本冻结 + 回归 + tag | `release/<ver>` → master + tag |

## 3. PRD 文档规范

- **位置**：`docs/prd/`
- **命名**：`PRD-<阶段>-<名称>.md`，如 `PRD-A1-base-architecture.md`
- **模板**：`docs/prd/PRD-TEMPLATE.md`
- **生命周期**：草稿 → 评审 → approved（定稿）→ 开发中 → 已验收
- **变更纪律**：`approved` 之后需求变更，必须在 PRD 中追加「变更记录」小节

## 4. 状态联动

| 文档 | 状态来源 | 更新时机 |
|---|---|---|
| `docs/TODO.yaml` | 阶段状态 | 立项时 in_progress；验收通过后 done |
| `docs/prd/PRD-*.md` | PRD 生命周期状态 | 各步骤推进时更新 |
| `CHANGELOG.md` | 变更记录 | 每阶段收尾追加 |

## 5. 验收纪律

- 验收标准必须**可执行**：命令、断言、可勾选清单
- 未达标准不标记完成

## 6. 与 Git Flow 的配合

- 每份 PRD 对应一个 feature 分支：`feature/<阶段>-<short-name>`
- PRD 文档本身在立项阶段提交（`prd(阶段): 添加 PRD`），在 `prd-update` 分支
- 阶段合并：`git merge --no-ff` 回 develop
