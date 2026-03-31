import { create } from 'zustand';

export interface NotificationItem {
    id: string;
    level: 'info' | 'warning' | 'error';
    message: string;
    actions?: { label: string; onClick: () => void }[];
    createdAt: number;
}

export interface NotificationState {
    notifications: NotificationItem[];
    addNotification: (
        notification: Omit<NotificationItem, 'id' | 'createdAt'>,
    ) => string;
    removeNotification: (id: string) => void;
    clearAll: () => void;
}

const MAX_NOTIFICATIONS = 10;

let counter = 0;

function generateId(): string {
    counter += 1;
    return `notif-${counter}-${Date.now()}`;
}

export const useNotification = create<NotificationState>((set) => ({
    notifications: [],

    addNotification: (notification) => {
        const id = generateId();
        const item: NotificationItem = {
            ...notification,
            id,
            createdAt: Date.now(),
        };

        set((state) => {
            const updated = [...state.notifications, item];

            if (updated.length > MAX_NOTIFICATIONS) {
                // Find the oldest non-error notification and remove it
                const oldestNonErrorIndex = updated.findIndex(
                    (n) => n.level !== 'error',
                );
                if (oldestNonErrorIndex !== -1) {
                    updated.splice(oldestNonErrorIndex, 1);
                }
            }

            return { notifications: updated };
        });

        return id;
    },

    removeNotification: (id) => {
        set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
        }));
    },

    clearAll: () => {
        set({ notifications: [] });
    },
}));
