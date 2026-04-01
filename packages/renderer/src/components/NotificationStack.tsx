import { useEffect, useRef, useCallback } from "react";
import { Info, AlertTriangle, XCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotification, type NotificationItem } from "../stores/notification";

const AUTO_DISMISS_MS = 5000;

const levelConfig = {
  info: {
    icon: Info,
    containerClass: "border-cyan-500/40 bg-cyan-950/60",
    iconClass: "text-cyan-400",
    label: "信息",
  },
  warning: {
    icon: AlertTriangle,
    containerClass: "border-amber-500/40 bg-amber-950/60",
    iconClass: "text-amber-400",
    label: "警告",
  },
  error: {
    icon: XCircle,
    containerClass: "border-red-500/40 bg-red-950/60",
    iconClass: "text-red-400",
    label: "错误",
  },
} as const;

function NotificationCard({ notification }: { notification: NotificationItem }) {
  const removeNotification = useNotification((s) => s.removeNotification);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (notification.level !== "error") {
      timerRef.current = setTimeout(() => {
        removeNotification(notification.id);
      }, AUTO_DISMISS_MS);
    }
    return clearTimer;
  }, [notification.id, notification.level, removeNotification, clearTimer]);

  const config = levelConfig[notification.level];
  const Icon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      role="alert"
      data-level={notification.level}
      className={`flex flex-col gap-2 w-80 rounded-lg border p-3 shadow-lg ${config.containerClass}`}
    >
      <div className="flex items-start gap-2">
        <Icon size={18} className={`shrink-0 mt-0.5 ${config.iconClass}`} aria-label={config.label} />
        <p className="flex-1 text-sm text-white break-words">{notification.message}</p>
        <button
          onClick={() => removeNotification(notification.id)}
          className="shrink-0 p-0.5 rounded hover:bg-white/10 text-t-secondary hover:text-white transition-colors"
          aria-label="关闭通知"
        >
          <X size={14} />
        </button>
      </div>
      {notification.actions && notification.actions.length > 0 && (
        <div className="flex gap-2 ml-6">
          {notification.actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                action.onClick();
                removeNotification(notification.id);
              }}
              className="text-xs font-medium px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function NotificationStack() {
  const notifications = useNotification((s) => s.notifications);

  return (
    <div className="fixed bottom-10 right-4 z-[9998] flex flex-col gap-2 pointer-events-auto">
      <AnimatePresence mode="popLayout">
        {notifications.map((notification) => (
          <NotificationCard key={notification.id} notification={notification} />
        ))}
      </AnimatePresence>
    </div>
  );
}
