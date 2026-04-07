import { NotificationStack as BaseNotificationStack } from "@ftre/ui";
import { useNotification } from "@/stores/notification";

export function NotificationStack() {
  const notifications = useNotification((s) => s.notifications);
  const removeNotification = useNotification((s) => s.removeNotification);

  return (
    <BaseNotificationStack
      notifications={notifications}
      onDismiss={removeNotification}
      position="bottom-right"
    />
  );
}
