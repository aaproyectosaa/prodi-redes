import { useEffect } from "react";
import { toast } from "sonner";
import { listenForegroundPush } from "@/lib/webPush";
import { prepararSonido, sonarProdi } from "@/lib/sonido";

/** Muestra toast (con el sonido de Prodi) si llega un push con la app abierta (Android/desktop). */
export function ForegroundPushListener() {
  useEffect(() => {
    // El navegador deja sonar recién después del primer toque: se desbloquea acá.
    prepararSonido();
    return listenForegroundPush(({ title, body, url }) => {
      sonarProdi();
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
