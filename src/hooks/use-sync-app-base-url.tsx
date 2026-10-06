import { useEffect, useRef } from "react";
import { doc, getDoc, setDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import {
  APP_SETTINGS_WHATSAPP_DOC,
  isLocalAppOrigin,
  resolveClientAppOrigin,
} from "@/lib/whatsappNotifications";

/**
 * Guarda en Firestore la URL desde la que se usa la app (ej. donde el PM aprueba).
 * El bot de WhatsApp la usa para armar los links de las notificaciones.
 */
export function useSyncAppBaseUrl(enabled: boolean) {
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!enabled || syncedRef.current) return;

    const origin = resolveClientAppOrigin();
    if (!origin.startsWith("http")) return;

    syncedRef.current = true;

    void (async () => {
      try {
        const ref = doc(db, ...APP_SETTINGS_WHATSAPP_DOC);
        const snap = await getDoc(ref);
        const data = snap.data() as
          | { app_base_url?: string; app_base_url_manual?: boolean }
          | undefined;

        if (data?.app_base_url_manual && data.app_base_url) return;

        const isLocal = isLocalAppOrigin(origin);
        const current = data?.app_base_url?.replace(/\/$/, "");
        const currentIsLocal = current ? isLocalAppOrigin(current) : true;

        // No pisar una URL pública con localhost.
        if (isLocal && current && !currentIsLocal) return;

        if (current === origin) return;

        await setDoc(
          ref,
          {
            app_base_url: origin,
            app_base_url_updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn("No se pudo sincronizar app_base_url:", err);
      }
    })();
  }, [enabled]);
}
