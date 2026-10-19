import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useInAppNotifications } from "@/hooks/use-in-app-notifications";
import { avisoDeChatVisible, chatDeLink, EVENTO_CHAT_A_LA_VISTA } from "@/lib/redes/chatDock";

/** ¿El aviso lleva a lo que se está mirando ahora? (mismo chat abierto, mismo video, misma pantalla). */
function yaALaVista(link: string, pathname: string, search: string): boolean {
  if (chatDeLink(link)) return avisoDeChatVisible(link);
  let url: URL;
  try {
    url = new URL(link, window.location.origin);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  const actual = new URLSearchParams(search);
  // La ficha del video se abre encima de cualquier pantalla.
  const video = url.searchParams.get("video");
  if (video) return actual.get("video") === video;
  const ruta = url.pathname.replace(/\/$/, "");
  if (!ruta || ruta !== pathname.replace(/\/$/, "")) return false;
  for (const [k, v] of url.searchParams) if (actual.get(k) !== v) return false;
  return true;
}

/**
 * Cuando se abre lo que avisaba una notificación (el chat, el video, la pieza, la pantalla), el aviso queda leído solo:
 * así no hay que entrar a Avisos a marcarlo.
 */
export function LeerAvisosALaVista({ uid }: { uid: string | undefined }) {
  const { notifications, markRead } = useInAppNotifications(uid);
  const { pathname, search } = useLocation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const otraVez = () => setTick((t) => t + 1);
    window.addEventListener(EVENTO_CHAT_A_LA_VISTA, otraVez);
    document.addEventListener("visibilitychange", otraVez);
    return () => {
      window.removeEventListener(EVENTO_CHAT_A_LA_VISTA, otraVez);
      document.removeEventListener("visibilitychange", otraVez);
    };
  }, []);

  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    for (const n of notifications) {
      if (!n.read && n.link && yaALaVista(n.link, pathname, search)) void markRead(n.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications, pathname, search, tick]);

  return null;
}
