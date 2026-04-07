import { useEffect, useRef, useCallback } from "react";
import { Info, AlertTriangle, XCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../utils/cn";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationItem {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  actions?: NotificationAction[];
}

export interface NotificationStackProps {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
  /** Auto-dismiss delay in ms, set to 0 to disable. Default: 5000 */
  autoDismissMs?: number;
  /** Position of the stack */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  className?: string;
}

const levelConfig = {
  info: {
    icon: Info,
    containerClass:
      "border-[var(--ftre-info,#58a6ff)]/40 bg-[var(--ftre-info,#58a6ff)]/10",
    iconClass: "text-[var(--ftre-info,#58a6ff)]",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    containerClass:
      "border-[var(--ftre-warning,#d29922)]/40 bg-[var(--ftre-warning,#d29922)]/10",
    iconClass: "text-[var(--ftre-warning,#d29922)]",
    label: "Warning",
  },
  error: {
    icon: XCircle,
    containerClass:
      "border-[var(--ftre-error,#f85149)]/40 bg-[var(--ftre-error,#f85149)]/10",
    iconClass: "text-[var(--ftre-error,#f85149)]",
    label: "Error",
  },
} as const;

const positionClasses = {
  "bottom-right": "bottom-10 right-4",
  "bottom-left": "bottom-10 left-4",
  "top-right": "top-10 right-4",
  "top-left": "top-10 left-4",
};

interface NotificationCardProps {
  notification: NotificationItem;
  onDismiss: (id: string) => void;
  autoDismissMs: number;
}

function NotificationCard({
  notification,
  onDismiss,
  autoDismissMs,
}: NotificationCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (autoDismissMs > 0 && notification.level !== "error") {
      timerRef.current = setTimeout(() => {
        onDismiss(notification.id);
      }, autoDismissMs);
    }
    return clearTimer;
  }, [
    notification.id,
    notification.level,
    onDismiss,
    clearTimer,
    autoDismissMs,
  ]);

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
      className={cn(
        "flex flex-col gap-2 w-80 rounded border p-3 shadow-lg",
        config.containerClass,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          size={16}
          className={cn("shrink-0 mt-0.5", config.iconClass)}
          aria-label={config.label}
        />
        <p className="flex-1 text-sm text-[var(--ftre-text-primary,#e8e8e8)] break-words">
          {notification.message}
        </p>
        <button
          onClick={() => onDismiss(notification.id)}
          className="shrink-0 p-0.5 rounded hover:bg-[var(--ftre-accent-ghost,rgba(0,255,136,0.06))] text-[var(--ftre-text-secondary,#cccccc)] hover:text-[var(--ftre-text-primary,#e8e8e8)] transition-colors"
          aria-label="Close notification"
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
                onDismiss(notification.id);
              }}
              className="text-xs font-medium px-2 py-1 rounded bg-[var(--ftre-panel,#333333)] hover:bg-[var(--ftre-border,#3c3c3c)] text-[var(--ftre-text-primary,#e8e8e8)] transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function NotificationStack({
  notifications,
  onDismiss,
  autoDismissMs = 5000,
  position = "bottom-right",
  className,
}: NotificationStackProps) {
  return (
    <div
      className={cn(
        "fixed z-[9998] flex flex-col gap-2 pointer-events-auto",
        positionClasses[position],
        className,
      )}
    >
      <AnimatePresence mode="popLayout">
        {notifications.map((notification) => (
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
}
