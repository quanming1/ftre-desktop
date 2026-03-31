import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotification } from './notification';

beforeEach(() => {
    useNotification.setState({ notifications: [] });
});

describe('notification store — addNotification', () => {
    it('adds a notification with generated id and createdAt', () => {
        const id = useNotification.getState().addNotification({
            level: 'info',
            message: 'Hello',
        });

        const notifications = useNotification.getState().notifications;
        expect(notifications).toHaveLength(1);
        expect(notifications[0].id).toBe(id);
        expect(notifications[0].level).toBe('info');
        expect(notifications[0].message).toBe('Hello');
        expect(typeof notifications[0].createdAt).toBe('number');
    });

    it('generates unique ids for each notification', () => {
        const store = useNotification.getState();
        const id1 = store.addNotification({ level: 'info', message: 'A' });
        const id2 = useNotification
            .getState()
            .addNotification({ level: 'info', message: 'B' });
        expect(id1).not.toBe(id2);
    });

    it('preserves actions in the notification', () => {
        const onClick = vi.fn();
        useNotification.getState().addNotification({
            level: 'warning',
            message: 'Action needed',
            actions: [{ label: 'Retry', onClick }],
        });

        const notif = useNotification.getState().notifications[0];
        expect(notif.actions).toHaveLength(1);
        expect(notif.actions![0].label).toBe('Retry');
    });

    it('auto-removes oldest non-error notification when queue exceeds 10', () => {
        const store = useNotification.getState();

        // Add 10 info notifications
        for (let i = 0; i < 10; i++) {
            useNotification
                .getState()
                .addNotification({ level: 'info', message: `Info ${i}` });
        }
        expect(useNotification.getState().notifications).toHaveLength(10);

        // Add one more — should evict the oldest non-error
        useNotification
            .getState()
            .addNotification({ level: 'info', message: 'Info 10' });
        const notifications = useNotification.getState().notifications;
        expect(notifications).toHaveLength(10);
        // The first info (Info 0) should have been removed
        expect(notifications[0].message).toBe('Info 1');
        expect(notifications[9].message).toBe('Info 10');
    });

    it('skips error notifications when evicting oldest', () => {
        // Add an error notification first, then fill with info
        useNotification
            .getState()
            .addNotification({ level: 'error', message: 'Error 0' });
        for (let i = 1; i <= 9; i++) {
            useNotification
                .getState()
                .addNotification({ level: 'info', message: `Info ${i}` });
        }
        expect(useNotification.getState().notifications).toHaveLength(10);

        // Add one more — should evict the oldest non-error (Info 1), not Error 0
        useNotification
            .getState()
            .addNotification({ level: 'info', message: 'Info 10' });
        const notifications = useNotification.getState().notifications;
        expect(notifications).toHaveLength(10);
        expect(notifications[0].message).toBe('Error 0');
        expect(notifications[1].message).toBe('Info 2');
    });

    it('does not evict when all are error and queue exceeds 10', () => {
        // Fill with 10 error notifications
        for (let i = 0; i < 10; i++) {
            useNotification
                .getState()
                .addNotification({ level: 'error', message: `Error ${i}` });
        }

        // Add one more error — no non-error to evict, so queue grows to 11
        useNotification
            .getState()
            .addNotification({ level: 'error', message: 'Error 10' });
        expect(useNotification.getState().notifications).toHaveLength(11);
    });
});

describe('notification store — removeNotification', () => {
    it('removes a notification by id', () => {
        const id = useNotification
            .getState()
            .addNotification({ level: 'info', message: 'Remove me' });
        expect(useNotification.getState().notifications).toHaveLength(1);

        useNotification.getState().removeNotification(id);
        expect(useNotification.getState().notifications).toHaveLength(0);
    });

    it('does nothing when id does not exist', () => {
        useNotification
            .getState()
            .addNotification({ level: 'info', message: 'Keep me' });
        useNotification.getState().removeNotification('nonexistent');
        expect(useNotification.getState().notifications).toHaveLength(1);
    });

    it('only removes the targeted notification', () => {
        const id1 = useNotification
            .getState()
            .addNotification({ level: 'info', message: 'A' });
        const id2 = useNotification
            .getState()
            .addNotification({ level: 'info', message: 'B' });

        useNotification.getState().removeNotification(id1);
        const notifications = useNotification.getState().notifications;
        expect(notifications).toHaveLength(1);
        expect(notifications[0].id).toBe(id2);
    });
});

describe('notification store — clearAll', () => {
    it('removes all notifications', () => {
        useNotification
            .getState()
            .addNotification({ level: 'info', message: 'A' });
        useNotification
            .getState()
            .addNotification({ level: 'error', message: 'B' });
        useNotification
            .getState()
            .addNotification({ level: 'warning', message: 'C' });

        useNotification.getState().clearAll();
        expect(useNotification.getState().notifications).toHaveLength(0);
    });

    it('works on empty queue', () => {
        useNotification.getState().clearAll();
        expect(useNotification.getState().notifications).toHaveLength(0);
    });
});
