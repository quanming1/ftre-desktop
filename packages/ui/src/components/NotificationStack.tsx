import { useEffect, useRef, useCallback, useState } from "react";
import { Info, AlertTriangle, XCircle, X, GripHorizontal } from "lucide-react";
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
    containerClass: "border-[#58a6ff] bg-[#1a1b1d]",
    iconClass: "text-[#58a6ff]",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    containerClass: "border-[#d29922] bg-[#1a1b1d]",
    iconClass: "text-[#d29922]",
    label: "Warning",
  },
  error: {
    icon: XCircle,
    containerClass: "border-[#f85149] bg-[#1a1b1d]",
    iconClass: "text-[#f85149]",
    label: "Error",
  },
} as const;

const positionClasses = {
  "bottom-right": "bottom-8 right-6",
  "bottom-left": "bottom-8 left-6",
  "top-right": "top-10 right-6",
  "top-left": "top-10 left-6",
};

interface NotificationCardProps {
  notification: NotificationItem;
  onDismiss: (id: string) => void;
  autoDismissMs: number;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function NotificationCard({
  notification,
  onDismiss,
  autoDismissMs,
  position,
  containerRef,
}: NotificationCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef({ startX: 0, startY: 0, dragged: false });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [shouldDismiss, setShouldDismiss] = useState(false);

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, dragged: false };
      setIsHovered(false);
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current.startX && !dragRef.current.startY) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        dragRef.current.dragged = true;
      }
      setOffset({ x: dx, y: dy });
    },
    []
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      const threshold = 100;
      const isDismiss =
        (position.includes("left") && dx > threshold) ||
        (position.includes("right") && dx < -threshold) ||
        dy > threshold;

      if (dragRef.current.dragged && isDismiss) {
        setShouldDismiss(true);
      }

      dragRef.current = { startX: 0, startY: 0, dragged: false };
      setOffset({ x: 0, y: 0 });
    },
    [position]
  );

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    card.addEventListener("mousemove", handleMouseMove as EventListener);
    card.addEventListener("mouseup", handleMouseUp);
    card.addEventListener("mouseleave", handleMouseUp);

    return () => {
      card.removeEventListener("mousemove", handleMouseMove as EventListener);
      card.removeEventListener("mouseup", handleMouseUp);
      card.removeEventListener("mouseleave", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const isLeft = position.includes("left");
  const dismissX = isLeft ? offset.x : -offset.x;

  if (shouldDismiss) {
    return (
      <motion.div
        initial={{ opacity: 1, x: 0 }}
        animate={{ opacity: 0, x: isLeft ? 100 : -100 }}
        transition={{ duration: 0.15 }}
        onAnimationComplete={() => onDismiss(notification.id)}
      />
    );
  }

  return (
    <motion.div
      ref={cardRef}
      layout
      initial={{ opacity: 0, x: isLeft ? -50 : 50, scale: 0.95 }}
      animate={{ opacity: 1, x: Math.max(0, dismissX), scale: dismissX > 30 ? 0.95 : 1 }}
      exit={{ opacity: 0, x: isLeft ? -50 : 50, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      role="alert"
      data-level={notification.level}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMouseDown}
      className={cn(
        "flex flex-col gap-2 w-80 rounded border p-3 shadow-xl",
        "bg-[#1a1b1d] border-[#3c3c3c]",
        config.containerClass,
        dragRef.current.dragged && "cursor-grabbing select-none"
      )}
      style={{
        opacity: dismissX > 60 ? Math.max(0, 1 - (dismissX - 60) / 40) : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <GripHorizontal
          size={14}
          className={cn(
            "shrink-0 cursor-grab text-[#555555] transition-opacity",
            isHovered || dragRef.current.dragged ? "opacity-100" : "opacity-0"
          )}
        />
        <Icon
          size={16}
          className={cn("shrink-0", config.iconClass)}
          aria-label={config.label}
        />
        <p className="flex-1 text-sm text-[#e8e8e8] break-words leading-relaxed">
          {notification.message}
        </p>
        <button
          onClick={() => onDismiss(notification.id)}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            "shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all",
            isHovered
              ? "bg-[rgba(255,255,255,0.08)] text-[#e8e8e8]"
              : "text-[#888888] hover:text-[#e8e8e8]"
          )}
          aria-label="Close notification"
        >
          <X size={16} />
        </button>
      </div>
      {notification.actions && notification.actions.length > 0 && (
        <div className="flex gap-2 ml-8">
          {notification.actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                action.onClick();
                onDismiss(notification.id);
              }}
              className="text-xs font-medium px-3 py-1.5 rounded bg-[#333333] hover:bg-[#3c3c3c] text-[#e8e8e8] transition-colors"
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
  position = "bottom-left",
  className,
}: NotificationStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
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
            position={position}
            containerRef={containerRef}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
