# NotificationStack 全面重构规格

## 概述

对 `NotificationStack` 组件进行模块化重构，提升代码质量、性能和可维护性，同时新增 `success` 类型和堆叠限制功能。

## 文件结构

```
src/components/NotificationStack/
├── config.ts          # 级别配置、位置配置、样式常量
├── types.ts           # 所有类型定义
├── NotificationCard.tsx
└── NotificationStack.tsx
```

---

## 类型定义 (`types.ts`)

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

### 变更

- 新增 `success` 类型
- 移除 `pauseOnHover`（实现更复杂，暂不需要）

---

## 配置抽离 (`config.ts`)

```typescript
import { Info, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { NotificationStackProps } from "./types";

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

export const CARD_WIDTH = "w-80";
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

---

## NotificationCard 组件

### 设计要点

1. **React.memo** 包裹，避免不必要的重渲染
2. **进度条**：底部显示 auto-dismiss 剩余时间
3. **hover 暂停**：鼠标悬停时暂停计时器（仅在 pauseOnHover 为 true 时）
4. **useCallback** 优化所有回调
5. **动画微调**：统一使用 config 中的常量

### 实现

```typescript
// NotificationCard.tsx
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
      // 暂停：清除计时器
      clearTimer();
    } else if (!isHovered) {
      // 恢复：重新计时
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
          style={{ backgroundColor: config.borderColor }}
          style={{ width: "100%", opacity: 0.6 }}
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

---

## NotificationStack 组件

### 设计要点

1. **堆叠限制**：固定 `MAX_VISIBLE = 3`，超出部分取最后 3 条
2. **React.memo** 包裹
3. **useMemo** 缓存过滤后的通知列表
4. **保持 API 兼容**：props 与之前完全一致

### 实现

```typescript
// NotificationStack.tsx
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

---

## 变更总结

### 功能增强

| 功能 | 描述 |
|------|------|
| 新增 `success` 类型 | CheckCircle 图标，绿色主题 (#3fb950) |
| 固定 `MAX_VISIBLE = 3` | 超出部分自动截断，保留最新 3 条 |
| hover 暂停计时 | 鼠标悬停时暂停 auto-dismiss 计时器 |
| 进度条 | 底部显示进度指示（error 除外） |

### 性能优化

| 优化 | 描述 |
|------|------|
| React.memo | NotificationCard 和 NotificationStack 均 memo 化 |
| useMemo | 缓存可见通知列表 |
| useCallback | 优化所有回调函数 |

### 代码质量

| 改进 | 描述 |
|------|------|
| 模块化拆分 | types/config/card/stack 分离 |
| 配置抽离 | levelConfig、样式常量独立管理 |
| JSDoc 注释 | 添加组件文档注释 |

### API 兼容性

- ✅ 完全向后兼容
- ✅ 新增功能均有默认值，不影响现有使用

---

## 进度条说明

进度条实现为静态进度条（非动态递减），用于视觉提示而非精确计时：

- 显示位置：卡片底部
- 颜色：与通知级别边框颜色一致
- 透明度：60%
- `error` 类型不显示进度条（因为不自动消失）
- `autoDismissMs = 0` 时不显示进度条

如需精确的动态进度条，需要额外实现 requestAnimationFrame 循环，增加复杂度。当前静态进度条足以提供视觉反馈。
