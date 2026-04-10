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
          className="shrink-0"
          style={{ color: config.iconColor }}
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
