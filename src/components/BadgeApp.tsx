import { useEffect } from "react";
import { useRedes } from "@/contexts/redes-data-context";
import { enModoVista } from "@/lib/redes/vistaComo";

type NavigatorBadge = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Numerito rojo en el ícono de la app instalada (como WhatsApp): chats con mensajes sin leer.
 * Anda en iPhone (iOS 16.4+, app instalada y con avisos permitidos) y en la compu (Chrome/Edge instalada).
 * En Android Chrome no hay número: el sistema muestra un puntito con las notificaciones.
 * Con la app cerrada lo sube el service worker al llegar un aviso de chat.
 */
export function BadgeApp() {
  const { chatsNoLeidos } = useRedes();
  useEffect(() => {
    if (enModoVista()) return;
    const nav = navigator as NavigatorBadge;
    const n = Math.max(0, chatsNoLeidos);
    try {
      if (n > 0) void nav.setAppBadge?.(n).catch(() => {});
      else void nav.clearAppBadge?.().catch(() => {});
    } catch {
      /* el navegador no lo soporta */
    }
    // El service worker guarda el número para seguir sumando con la app cerrada.
    navigator.serviceWorker?.controller?.postMessage({ tipo: "prodi-badge", n });
  }, [chatsNoLeidos]);
  return null;
}
