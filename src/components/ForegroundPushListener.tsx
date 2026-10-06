import { useEffect } from "react";
import { toast } from "sonner";
import { listenForegroundPush } from "@/lib/webPush";

/** Muestra toast si llega un push con la app abierta (Android/desktop). */
export function ForegroundPushListener() {
  useEffect(() => {
    return listenForegroundPush(({ title, body, url }) => {
      toast(title, {
        description: body,
        action: url
          ? {
              label: "Abrir",
              onClick: () => {
                window.location.href = url;
              },
            }
          : undefined,
        duration: 8000,
      });
    });
  }, []);

  return null;
}
