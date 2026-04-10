# NotificationStack 全面重构实现计划

> **执行方式**：串行执行，每个 task 完成后经过两阶段 review

**目标**：将 NotificationStack 组件模块化拆分，新增 success 类型和堆叠限制，提升性能和代码质量

**架构**：采用模块化架构，将类型、配置、组件分离到独立文件，支持 React.memo 优化渲染

**技术栈**：React, TypeScript, framer-motion, Tailwind CSS, lucide-react

---

## 文件结构

```
packages/ui/src/components/NotificationStack/
├── types.ts           # 所有类型定义
├── config.ts          # 级别配置、位置配置、样式常量
├── NotificationCard.tsx
└── NotificationStack.tsx

packages/ui/src/components/
├── (delete) NotificationStack.tsx  # 旧文件将被删除
└── index.ts            # 更新导出
```

---

## Task 1: 创建类型定义

**状态**：⏳ pending

**文件**：
- 创建: `packages/ui/src/components/NotificationStack/types.ts`

**步骤**：

- [ ] **Step 1: 创建 types.ts**

```typescript
// 通知级别
export type NotificationLevel = "info" | "success" | "warning" | "error";

// 通知动作按钮
export interface NotificationAction {
  label: string;
  onClick: () => void;
}

// 单条通知
export interface NotificationItem {
  id: string;
  level: NotificationLevel;
  message: string;
  actions?: NotificationAction[];
}

// 组件 props
export interface NotificationStackProps {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
  /** Auto-dismiss 延迟(ms)，设为 0 禁用，默认 5000 */
  autoDismissMs?: number;
  /** 堆叠位置，默认 "bottom-left" */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  className?: string;
}
```

- [ ] **Step 2: 提交**

```bash
cd packages/ui/src/components/NotificationStack
git add types.ts
git commit -m "feat(NotificationStack): create types.ts with NotificationLevel including success"
```

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

- [ ] **Step 1: 创建 config.ts**

```typescript
import { Info, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { NotificationLevel, NotificationStackProps } from "./types";

// ── 级别配置 ───────────────────────────────────────────────────

export const levelConfig: Record<
  NotificationLevel,
  {
    icon: typeof Info;
    borderColor: string;
    iconColor: string;
    label: string;
  }
> = {
  info: {
    icon: Info,
    borderColor: "#58a6ff",
    iconColor: "#58a6ff",
    label: "Info",
  },
  success: {
    icon: CheckCircle,
    borderColor: "#3fb950",
    iconColor: "#3fb950",
    label: "Success",
  },
  warning: {
    icon: AlertTriangle,
    borderColor: "#d29922",
    iconColor: "#d29922",
    label: "Warning",
  },
  error: {
    icon: XCircle,
    borderColor: "#f85149",
    iconColor: "#f85149",
    label: "Error",
  },
};

// ── 位置配置 ───────────────────────────────────────────────────

export const positionClasses: Record<
  NonNullable<NotificationStackProps["position"]>,
  string
> = {
  "bottom-right": "bottom-8 right-6",
  "bottom-left": "bottom-8 left-6",
  "top-right": "top-10 right-6",
  "top-left": "top-10 left-6",
};

// ── 样式常量 ───────────────────────────────────────────────────

export const MAX_VISIBLE = 3;

export const CARD_STYLES = {
  base: "flex flex-col gap-2 rounded border p-3 shadow-xl bg-[#1a1b1d] border-[#3c3c3c]",
  message: "text-sm text-[#e8e8e8] break-words leading-relaxed",
  closeButton: {
    default: "shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#888888] hover:text-[#e8e8e8]",
    hovered: "bg-[rgba(255,255,255,0.08)] text-[#e8e8e8]",
  },
  actionButton: "text-xs font-medium px-3 py-1.5 rounded bg-[#333333] hover:bg-[#3c3c3c] text-[#e8e8e8] transition-colors",
};

export const ANIMATION = {
  entry: { opacity: 0, y: 20, scale: 0.95 },
  exit: { opacity: 0, y: 20, scale: 0.95 },
  spring: { type: "spring" as const, stiffness: 400, damping: 30 },
};
```

- [ ] **Step 2: 提交**

```bash
git add config.ts
git commit -m "feat(NotificationStack): create config.ts with levelConfig (including success), positionClasses, and constants"
```

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

- [ ] **Step 1: 创建 NotificationCard.tsx**

```typescript
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../utils/cn";
import { useDragToDismiss } from "../../hooks/useDragToDismiss";
import { NotificationItem } from "./types";
import { levelConfig, CARD_STYLES, ANIMATION } from "./config";

interface NotificationCardProps {
  notification: NotificationItem;
  onDismiss: (id: string) => void;
  autoDismissMs: number;
}

export const NotificationCard = memo(function NotificationCard({
  notification,
  onDismiss,
  autoDismissMs,
}: NotificationCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  // ── 计时器逻辑 ────────────────────────────────────────────────
  
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (autoDismissMs <= 0 || notification.level === "error") return;

    timerRef.current = setTimeout(() => {
      onDismiss(notification.id);
    }, autoDismissMs);

    return clearTimer;
  }, [notification.id, notification.level, onDismiss, autoDismissMs, clearTimer]);

  // ── Hover 暂停计时 ────────────────────────────────────────────
  
  useEffect(() => {
    if (!autoDismissMs || notification.level === "error") return;

    if (isHovered && timerRef.current) {
      clearTimer();
    } else if (!isHovered) {
      timerRef.current = setTimeout(() => {
        onDismiss(notification.id);
      }, autoDismissMs);
    }
  }, [isHovered, autoDismissMs, notification.level, notification.id, onDismiss, clearTimer]);

  // ── 拖拽逻辑 ──────────────────────────────────────────────────
  
  const handleDismiss = useCallback(() => {
    onDismiss(notification.id);
  }, [onDismiss, notification.id]);

  const { handleMouseDown, state } = useDragToDismiss({
    threshold: 100,
    deadZone: 3,
    fadeStart: 40,
    fadeEnd: 120,
    axis: "x",
    onDismiss: handleDismiss,
  });

  // ── 动画完成回调 ──────────────────────────────────────────────
  
  const handleAnimationComplete = useCallback(
    (animation: { name?: string }) => {
      if (animation.name === "exit") {
        onDismiss(notification.id);
      }
    },
    [onDismiss, notification.id],
  );

  // ── 渲染 ──────────────────────────────────────────────────────
  
  const config = levelConfig[notification.level];
  const Icon = config.icon;

  const dismissDirection =
    state.distance > 0
      ? { x: state.velocity.x * 30, y: state.velocity.y * 30 }
      : { x: 0, y: 0 };

  return (
    <motion.div
      layout
      initial={ANIMATION.entry}
      animate={{
        opacity: state.isDismissed ? 0 : state.opacity,
        y: 0,
        scale: state.isDismissed ? 0.85 : state.scale,
        x: state.isDismissed ? dismissDirection.x : state.offset.x,
      }}
      exit={ANIMATION.exit}
      transition={state.isDragging ? { duration: 0 } : ANIMATION.spring}
      onAnimationComplete={handleAnimationComplete}
      role="alert"
      data-level={notification.level}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMouseDown}
      className={cn(
        "relative overflow-hidden",
        CARD_STYLES.base,
        state.isDragging && "cursor-grabbing select-none",
      )}
      style={{ borderColor: config.borderColor }}
    >
      {/* 进度条 - error 不自动消失，不显示进度条 */}
      {autoDismissMs > 0 && notification.level !== "error" && (
        <div
          className="absolute bottom-0 left-0 h-0.5 transition-all duration-100"
          style={{ backgroundColor: config.borderColor, width: "100%", opacity: 0.6 }}
        />
      )}

      {/* 主体内容 */}
      <div className="flex items-center gap-2">
        <Icon
          size={16}
          className={cn("shrink-0", config.iconColor)}
          aria-label={config.label}
        />
        <p className={cn("flex-1", CARD_STYLES.message)}>
          {notification.message}
        </p>
        <button
          onClick={() => onDismiss(notification.id)}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            CARD_STYLES.closeButton.default,
            isHovered && CARD_STYLES.closeButton.hovered,
          )}
          aria-label="Close notification"
        >
          <X size={16} />
        </button>
      </div>

      {/* 动作按钮 */}
      {notification.actions && notification.actions.length > 0 && (
        <div className="flex gap-2 ml-6">
          {notification.actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                action.onClick();
                onDismiss(notification.id);
              }}
              className={CARD_STYLES.actionButton}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
});
```

- [ ] **Step 2: 提交**

```bash
git add NotificationCard.tsx
git commit -m "feat(NotificationStack): create NotificationCard with React.memo, hover pause, and progress bar"
```

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

- [ ] **Step 1: 创建 NotificationStack.tsx**

```typescript
import { memo, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { cn } from "../../utils/cn";
import { NotificationStackProps } from "./types";
import { NotificationCard } from "./NotificationCard";
import { positionClasses, MAX_VISIBLE } from "./config";

/**
 * 通知堆叠组件
 * 
 * @remarks
 * - 支持拖拽、手动点击、auto-dismiss 三种关闭方式
 * - 固定最多显示 3 条通知（超出部分不显示）
 * - 支持 info/success/warning/error 四种级别
 * - error 级别不会自动消失
 */
export const NotificationStack = memo(function NotificationStack({
  notifications,
  onDismiss,
  autoDismissMs = 5000,
  position = "bottom-left",
  className,
}: NotificationStackProps) {
  // 限制最多显示 MAX_VISIBLE 条通知
  const visibleNotifications = useMemo(() => {
    if (notifications.length <= MAX_VISIBLE) {
      return notifications;
    }
    // 超出限制时，取最后 MAX_VISIBLE 条（新的保留，旧的移除）
    return notifications.slice(-MAX_VISIBLE);
  }, [notifications]);

  return (
    <div
      className={cn(
        "fixed z-[9998] flex flex-col gap-2 pointer-events-auto",
        positionClasses[position],
        className,
      )}
    >
      <AnimatePresence mode="popLayout">
        {visibleNotifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
            autoDismissMs={autoDismissMs}
          />
        ))}
      </AnimatePresence>
    </div>
  );
});
```

- [ ] **Step 2: 提交**

```bash
git add NotificationStack.tsx
git commit -m "feat(NotificationStack): create NotificationStack with MAX_VISIBLE=3 limit and useMemo optimization"
```

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

- [ ] **Step 1: 创建 index.ts**

```typescript
export { NotificationStack } from "./NotificationStack";
export { NotificationCard } from "./NotificationCard";
export type {
  NotificationItem,
  NotificationAction,
  NotificationLevel,
  NotificationStackProps,
} from "./types";
```

- [ ] **Step 2: 提交**

```bash
git add index.ts
git commit -m "feat(NotificationStack): create index.ts with all exports"
```

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

- [ ] **Step 1: 更新 index.ts 导出路径**

将：
```typescript
export {
  NotificationStack,
  type NotificationItem,
  type NotificationAction,
  type NotificationStackProps,
} from "./NotificationStack";
```

改为：
```typescript
export {
  NotificationStack,
  type NotificationItem,
  type NotificationAction,
  type NotificationLevel,
  type NotificationStackProps,
} from "./NotificationStack";
```

- [ ] **Step 2: 提交**

```bash
git add index.ts
git commit -m "chore: update NotificationStack exports to include NotificationLevel type"
```

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

- [ ] **Step 1: 删除旧文件**

```bash
rm packages/ui/src/components/NotificationStack.tsx
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/ui && npm run build 2>&1 | head -50
```
预期：无错误，build 成功

- [ ] **Step 3: 搜索旧引用**

```bash
grep -r "from.*NotificationStack" packages/ --include="*.ts" --include="*.tsx" | grep -v "NotificationStack/"
```
预期：无结果（或只有新目录内的引用）

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(NotificationStack): delete old single-file implementation"
```

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

- [ ] **Step 1: 运行完整类型检查**

```bash
cd packages/ui && npx tsc --noEmit 2>&1
```
预期：无错误输出

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "chore(NotificationStack): verify full type check passes"
```

---

## 自检清单

- [ ] 所有 5 个新文件已创建
- [ ] index.ts 导出已更新
- [ ] 旧文件已删除
- [ ] 新增 `success` 类型（CheckCircle, #3fb950）
- [ ] `MAX_VISIBLE = 3` 限制已实现
- [ ] React.memo 已应用于两个组件
- [ ] useMemo 用于可见通知列表
- [ ] useCallback 用于所有回调
- [ ] hover 暂停计时功能
- [ ] 进度条显示（非动态）
- [ ] 完整类型检查通过
- [ ] 所有 commit 已完成
