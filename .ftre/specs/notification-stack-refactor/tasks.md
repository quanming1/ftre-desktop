# 任务清单：NotificationStack 全面重构

> **执行方式**：串行执行
> **功能目录**：`.ftre/specs/notification-stack-refactor/`
> **设计文档**：`spec.md`
> **计划文档**：`plan.md`

---

## Task 1: 创建类型定义

**状态**：⏳ pending

**文件**：
- 创建: `packages/ui/src/components/NotificationStack/types.ts`

**步骤**：
- [ ] Step 1: 创建 types.ts
- [ ] Step 2: 提交

**验证**：
```bash
npx tsc --noEmit --skipLibCheck packages/ui/src/components/NotificationStack/types.ts
```
预期：无错误输出

---

## Task 2: 创建配置文件

**状态**：⏳ pending

**文件**：
- 创建: `packages/ui/src/components/NotificationStack/config.ts`

**步骤**：
- [ ] Step 1: 创建 config.ts
- [ ] Step 2: 提交

**验证**：
```bash
npx tsc --noEmit --skipLibCheck packages/ui/src/components/NotificationStack/config.ts
```
预期：无错误输出

---

## Task 3: 创建 NotificationCard 组件

**状态**：⏳ pending

**文件**：
- 创建: `packages/ui/src/components/NotificationStack/NotificationCard.tsx`

**步骤**：
- [ ] Step 1: 创建 NotificationCard.tsx
- [ ] Step 2: 提交

**验证**：
```bash
npx tsc --noEmit --skipLibCheck packages/ui/src/components/NotificationStack/NotificationCard.tsx
```
预期：无错误输出

---

## Task 4: 创建 NotificationStack 组件

**状态**：⏳ pending

**文件**：
- 创建: `packages/ui/src/components/NotificationStack/NotificationStack.tsx`

**步骤**：
- [ ] Step 1: 创建 NotificationStack.tsx
- [ ] Step 2: 提交

**验证**：
```bash
npx tsc --noEmit --skipLibCheck packages/ui/src/components/NotificationStack/NotificationStack.tsx
```
预期：无错误输出

---

## Task 5: 创建 index.ts 导出文件

**状态**：⏳ pending

**文件**：
- 创建: `packages/ui/src/components/NotificationStack/index.ts`

**步骤**：
- [ ] Step 1: 创建 index.ts
- [ ] Step 2: 提交

**验证**：
```bash
npx tsc --noEmit --skipLibCheck packages/ui/src/components/NotificationStack/index.ts
```
预期：无错误输出

---

## Task 6: 更新主 index.ts 导出

**状态**：⏳ pending

**文件**：
- 修改: `packages/ui/src/components/index.ts:108-113`

**步骤**：
- [ ] Step 1: 更新导出，添加 NotificationLevel 类型
- [ ] Step 2: 提交

**验证**：
```bash
npx tsc --noEmit --skipLibCheck packages/ui/src/components/index.ts
```
预期：无错误输出

---

## Task 7: 删除旧文件并验证

**状态**：⏳ pending

**文件**：
- 删除: `packages/ui/src/components/NotificationStack.tsx`

**步骤**：
- [ ] Step 1: 删除旧文件
- [ ] Step 2: 验证编译
- [ ] Step 3: 搜索旧引用
- [ ] Step 4: 提交

**验证**：
```bash
ls packages/ui/src/components/NotificationStack/
```
预期：显示 types.ts, config.ts, index.ts, NotificationCard.tsx, NotificationStack.tsx

---

## Task 8: 完整类型检查

**状态**：⏳ pending

**文件**：
- 全包编译验证

**步骤**：
- [ ] Step 1: 运行完整类型检查
- [ ] Step 2: 提交

**验证**：
```bash
cd packages/ui && npx tsc --noEmit 2>&1
```
预期：无错误输出

---

## 进度总结

| Task | 描述 | 状态 |
|------|------|------|
| 1 | 创建类型定义 (types.ts) | ⏳ |
| 2 | 创建配置文件 (config.ts) | ⏳ |
| 3 | 创建 NotificationCard 组件 | ⏳ |
| 4 | 创建 NotificationStack 组件 | ⏳ |
| 5 | 创建 index.ts 导出文件 | ⏳ |
| 6 | 更新主 index.ts 导出 | ⏳ |
| 7 | 删除旧文件并验证 | ⏳ |
| 8 | 完整类型检查 | ⏳ |

**总计**：8 个任务
