import { create } from "zustand";
import { toast } from "sonner";

export interface NotificationItem {
  id: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
  actions?: { label: string; onClick: () => void }[];
  createdAt: number;
}

export interface NotificationState {
  notifications: NotificationItem[];
  addNotification: (
    notification: Omit<NotificationItem, "id" | "createdAt">,
  ) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

let counter = 0;

function generateId(): string {
  counter += 1;
  return `notif-${counter}-${Date.now()}`;
}

const sonnerMap = new Map<string, string>();

export const useNotification = create<NotificationState>((set) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = generateId();
    const item: NotificationItem = {
      ...notification,
      id,
      createdAt: Date.now(),
    };

    // 使用 sonner 显示 toast
    const sonnerId = toast(notification.message, {
      id,
      duration:
        notification.level === "error" ? Infinity : notification.level === "warning" ? 8000 : 5000,
    });

    // 记录 sonner id 映射
    sonnerMap.set(id, sonnerId as string);

    set((state) => ({
      notifications: [...state.notifications, item].slice(-10),
    }));

    return id;
  },

  removeNotification: (id) => {
    // 同时 dismiss sonner toast
    const sonnerId = sonnerMap.get(id);
    if (sonnerId) {
      toast.dismiss(sonnerId);
      sonnerMap.delete(id);
    }

    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    toast.dismiss();
    sonnerMap.clear();
    set({ notifications: [] });
  },
}));
