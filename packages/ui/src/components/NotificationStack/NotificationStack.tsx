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
