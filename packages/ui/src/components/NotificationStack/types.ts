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
