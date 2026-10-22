import * as Notifications from "expo-notifications";
import { useEffect } from "react";

export function usePushRouting(onEphemeral: (deliveryId: string) => void) {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (res: any) => {
        const data = res.notification.request.content.data as any;
        const url =
          (data?.url as string) ||
          (res.notification.request.content as any).data?.url;
        const deliveryId = data?.deliveryId || url?.split("/").pop();
        if (deliveryId) onEphemeral(deliveryId);
      },
    );
    Notifications.getLastNotificationResponseAsync().then((last: any) => {
      if (!last) return;
      const data = last.notification.request.content.data as any;
      const url = (data?.url as string) || "";
      const deliveryId = data?.deliveryId || url.split("/").pop();
      if (deliveryId) onEphemeral(deliveryId);
    });
    return () => sub.remove();
  }, []);
}
