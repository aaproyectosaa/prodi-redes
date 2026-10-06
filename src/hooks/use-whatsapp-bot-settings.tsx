import { useEffect, useState } from "react";
import { doc, onSnapshot } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import {
  APP_SETTINGS_WHATSAPP_DOC,
  DEFAULT_WHATSAPP_BOT_SETTINGS,
  mergeWhatsAppBotSettings,
  type WhatsAppBotSettings,
} from "@/lib/whatsappNotifications";

export function useWhatsAppBotSettings() {
  const [settings, setSettings] = useState<WhatsAppBotSettings>(
    DEFAULT_WHATSAPP_BOT_SETTINGS
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, ...APP_SETTINGS_WHATSAPP_DOC);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setSettings(
          snap.exists()
            ? mergeWhatsAppBotSettings(snap.data() as Partial<WhatsAppBotSettings>)
            : DEFAULT_WHATSAPP_BOT_SETTINGS
        );
        setLoading(false);
      },
      () => {
        setSettings(DEFAULT_WHATSAPP_BOT_SETTINGS);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { settings, loading };
}
